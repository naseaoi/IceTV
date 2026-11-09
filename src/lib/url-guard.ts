import { lookup } from 'dns/promises';
import net from 'net';

import { isDevProxyActive } from '@/lib/dev-proxy';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { UpstreamCooldownError } from '@/lib/server-resource-errors';
import {
  fetchViaUpstreamRoute,
  getUpstreamRoutes,
  isUpstreamNetworkFailure,
  reportUpstreamRouteFailure,
  reportUpstreamRouteSuccess,
} from '@/lib/upstream-proxy-pool.server';
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';
import type { UpstreamResourceContext } from '@/lib/upstream-resource-policy';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
]);

const MAX_REDIRECTS = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DNS_CACHE_TTL_MS = 30_000;
const DEFAULT_DNS_NEGATIVE_CACHE_TTL_MS = 5_000;
const DNS_CACHE_MAX_ENTRIES = 1024;

type DnsLookup = typeof lookup;

type GuardedFetchInit = RequestInit & {
  skipInitialValidation?: boolean;
  timeoutMs?: number;
  resourceContext?: UpstreamResourceContext;
  useProxyPool?: boolean;
};

type DnsCacheEntry = {
  addresses: { address: string }[];
  expiresAt: number;
  failed?: boolean;
};

const dnsCache = new Map<string, DnsCacheEntry>();
let dnsLookup: DnsLookup = lookup;

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export class UrlValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'UrlValidationError';
  }
}

export function validateProxyUrl(raw: string): UrlValidationResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL encoding' };
  }

  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only http/https allowed' };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(hostname) || isBlockedAddress(hostname)) {
    return { ok: false, reason: 'Blocked destination' };
  }

  return { ok: true, url: decoded };
}

export async function validateProxyUrlForRequest(
  raw: string,
): Promise<UrlValidationResult> {
  const parsed = validateProxyUrl(raw);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    await assertSafeNetworkTarget(parsed.url);
    return parsed;
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return { ok: false, reason: error.reason };
    }
    return { ok: false, reason: 'Blocked destination' };
  }
}

export async function fetchWithUrlGuard(
  raw: string,
  init: GuardedFetchInit = {},
): Promise<Response> {
  const {
    skipInitialValidation = false,
    timeoutMs,
    resourceContext,
    useProxyPool = true,
    ...fetchInit
  } = init;
  let currentUrl = raw;
  const requestedRedirect = fetchInit.redirect;
  const fetchTimeoutMs =
    Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
      ? Math.floor(Number(timeoutMs))
      : getFetchTimeoutMs();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validation =
      skipInitialValidation && redirectCount === 0
        ? { ok: true as const, url: currentUrl }
        : await validateProxyUrlForRequest(currentUrl);
    if (!validation.ok) {
      throw new UrlValidationError(validation.reason);
    }

    const abortState = createTimedAbortController(
      fetchInit.signal ?? undefined,
      fetchTimeoutMs,
    );
    let response: Response;
    try {
      response = await loadUpstream(
        validation.url,
        fetchInit,
        resourceContext,
        abortState.signal,
        useProxyPool,
      );
    } finally {
      abortState.cleanup();
    }

    if (!isRedirectResponse(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    if (response.body) {
      await response.body.cancel();
    }

    if (requestedRedirect === 'error') {
      throw new UrlValidationError('Redirect not allowed');
    }

    currentUrl = new URL(location, validation.url).toString();
  }

  throw new UrlValidationError('Too many redirects');
}

// 换出口只发生在拿到响应之前；节点网络失败或对该站处于冷却时顺延到下一个出口
async function loadUpstream(
  url: string,
  fetchInit: RequestInit,
  resourceContext: UpstreamResourceContext | undefined,
  signal: AbortSignal,
  useProxyPool: boolean,
): Promise<Response> {
  const routes = getUpstreamRoutes(resourceContext?.identity, useProxyPool);
  for (let index = 0; ; index++) {
    const route = routes[index];
    try {
      const response = await withUpstreamResponse(
        url,
        (guardSignal) =>
          fetchViaUpstreamRoute(route, url, {
            ...fetchInit,
            redirect: 'manual',
            signal: guardSignal,
          }),
        {
          ...resourceContext,
          signal,
          cooldownScope: route.proxyUrl ? route.id : undefined,
        },
      );
      reportUpstreamRouteSuccess(route);
      return response;
    } catch (error) {
      const proxyFailed =
        Boolean(route.proxyUrl) && isUpstreamNetworkFailure(error);
      if (proxyFailed) reportUpstreamRouteFailure(route);
      const retryable = proxyFailed || error instanceof UpstreamCooldownError;
      if (!retryable || signal.aborted || index + 1 >= routes.length)
        throw error;
    }
  }
}

export function clearUrlGuardDnsCacheForTests(): void {
  dnsCache.clear();
}

export function getUrlGuardDnsCacheSizeForTests(): number {
  return dnsCache.size;
}

export function setUrlGuardDnsLookupForTests(nextLookup: DnsLookup): void {
  dnsLookup = nextLookup;
}

export function resetUrlGuardDnsLookupForTests(): void {
  dnsLookup = lookup;
}

function getFetchTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env.PROXY_FETCH_TIMEOUT_MS || '',
    10,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_FETCH_TIMEOUT_MS;
}

function getDnsCacheTtlMs(): number {
  const configured = Number.parseInt(
    process.env.PROXY_DNS_CACHE_TTL_MS || '',
    10,
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_DNS_CACHE_TTL_MS;
}

function getDnsNegativeCacheTtlMs(): number {
  const configured = Number.parseInt(
    process.env.PROXY_DNS_NEGATIVE_CACHE_TTL_MS || '',
    10,
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_DNS_NEGATIVE_CACHE_TTL_MS;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function isBlockedHostname(hostname: string): boolean {
  return (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
}

async function assertSafeNetworkTarget(raw: string): Promise<void> {
  const parsed = new URL(raw);
  const hostname = normalizeHostname(parsed.hostname);

  if (isBlockedHostname(hostname)) {
    throw new UrlValidationError('Blocked destination');
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new UrlValidationError('Blocked destination');
    }
    return;
  }

  if (isDevProxyActive()) {
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookupHostname(hostname);
  } catch {
    throw new UrlValidationError('DNS lookup failed');
  }

  if (addresses.length === 0) {
    throw new UrlValidationError('DNS lookup failed');
  }

  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new UrlValidationError('Blocked destination');
  }
}

async function lookupHostname(
  hostname: string,
): Promise<{ address: string }[]> {
  const ttlMs = getDnsCacheTtlMs();
  const now = Date.now();
  const cached = dnsCache.get(hostname);
  if (ttlMs > 0 && cached && cached.expiresAt > now) {
    dnsCache.delete(hostname);
    dnsCache.set(hostname, cached);
    if (cached.failed) {
      throw new Error('DNS lookup failed');
    }
    return cached.addresses;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const negativeTtlMs = getDnsNegativeCacheTtlMs();
    if (negativeTtlMs > 0) {
      setDnsCacheEntry(
        hostname,
        { addresses: [], expiresAt: now + negativeTtlMs, failed: true },
        now,
      );
    }
    throw error;
  }

  if (ttlMs > 0) {
    setDnsCacheEntry(hostname, { addresses, expiresAt: now + ttlMs }, now);
  }
  return addresses;
}

// hostname 来自外部 URL，基数不可控；Map 按插入顺序充当 LRU，命中时移到队尾
function setDnsCacheEntry(
  hostname: string,
  entry: DnsCacheEntry,
  now: number,
): void {
  dnsCache.delete(hostname);
  dnsCache.set(hostname, entry);
  if (dnsCache.size <= DNS_CACHE_MAX_ENTRIES) return;

  dnsCache.forEach((value, key) => {
    if (value.expiresAt <= now) dnsCache.delete(key);
  });
  for (const key of dnsCache.keys()) {
    if (dnsCache.size <= DNS_CACHE_MAX_ENTRIES) break;
    dnsCache.delete(key);
  }
}

function isRedirectResponse(status: number): boolean {
  return status >= 300 && status < 400;
}

function isBlockedAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const ipVersion = net.isIP(normalized);

  if (ipVersion === 4) {
    return isBlockedIpv4(normalized);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(normalized);
  }

  return false;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  if (bytes) {
    const embeddedIpv4 = extractEmbeddedIpv4(bytes);
    if (embeddedIpv4 && isBlockedIpv4(embeddedIpv4)) {
      return true;
    }
    if (isBlockedIpv6Bytes(bytes)) {
      return true;
    }
  }
  return isBlockedIpv6ByPrefix(address);
}

function isBlockedIpv6Bytes(bytes: number[]): boolean {
  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const isUniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const isLinkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const isSiteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
  const isMulticast = bytes[0] === 0xff;

  return (
    isUnspecified ||
    isLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    isSiteLocal ||
    isMulticast
  );
}

function extractEmbeddedIpv4(bytes: number[]): string | null {
  const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0);
  const isMapped = firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompatible = bytes.slice(0, 12).every((byte) => byte === 0);
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b;
  const is6to4 = bytes[0] === 0x20 && bytes[1] === 0x02;

  if (isMapped || isCompatible || isNat64) {
    return bytes.slice(12, 16).join('.');
  }

  if (is6to4) {
    return bytes.slice(2, 6).join('.');
  }

  return null;
}

function ipv6ToBytes(address: string): number[] | null {
  let head = address;
  const lastColon = head.lastIndexOf(':');
  const tail = head.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map((part) => Number.parseInt(part, 10));
    if (
      octets.length !== 4 ||
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null;
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    head = `${head.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = head.split('::');
  if (halves.length > 2) {
    return null;
  }

  const headGroups = halves[0] ? halves[0].split(':') : [];
  const tailGroups =
    halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) {
      return null;
    }
    groups = [...headGroups, ...new Array(missing).fill('0'), ...tailGroups];
  } else {
    groups = headGroups;
  }

  if (groups.length !== 8) {
    return null;
  }

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null;
    }
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  return bytes;
}

function isBlockedIpv6ByPrefix(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('64:ff9b:') ||
    lower.startsWith('100:') ||
    lower.startsWith('2001:2:') ||
    lower.startsWith('2001:db8:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('ff')
  );
}
