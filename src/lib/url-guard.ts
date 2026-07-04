import { lookup } from 'dns/promises';
import net from 'net';

import { isDevProxyActive } from '@/lib/dev-proxy';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
]);

const MAX_REDIRECTS = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DNS_CACHE_TTL_MS = 30_000;
const DEFAULT_DNS_NEGATIVE_CACHE_TTL_MS = 5_000;

type DnsLookup = typeof lookup;

type GuardedFetchInit = RequestInit & {
  skipInitialValidation?: boolean;
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
  const { skipInitialValidation = false, ...fetchInit } = init;
  let currentUrl = raw;
  const requestedRedirect = fetchInit.redirect;
  const timeoutMs = getFetchTimeoutMs();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validation =
      skipInitialValidation && redirectCount === 0
        ? { ok: true as const, url: currentUrl }
        : await validateProxyUrlForRequest(currentUrl);
    if (!validation.ok) {
      throw new UrlValidationError(validation.reason);
    }

    const controller = new AbortController();
    const timeout = windowLikeSetTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(validation.url, {
        ...fetchInit,
        redirect: 'manual',
        signal: fetchInit.signal || controller.signal,
      });
    } finally {
      windowLikeClearTimeout(timeout);
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

export function clearUrlGuardDnsCacheForTests(): void {
  dnsCache.clear();
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

function windowLikeSetTimeout(
  callback: () => void,
  timeoutMs: number,
): ReturnType<typeof setTimeout> {
  return setTimeout(callback, timeoutMs);
}

function windowLikeClearTimeout(timeout: ReturnType<typeof setTimeout>): void {
  clearTimeout(timeout);
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
      dnsCache.set(hostname, {
        addresses: [],
        expiresAt: now + negativeTtlMs,
        failed: true,
      });
    }
    throw error;
  }

  if (ttlMs > 0) {
    dnsCache.set(hostname, { addresses, expiresAt: now + ttlMs });
  }
  return addresses;
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
