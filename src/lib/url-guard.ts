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
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = raw;
  const requestedRedirect = init.redirect;
  const timeoutMs = getFetchTimeoutMs();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validation = await validateProxyUrlForRequest(currentUrl);
    if (!validation.ok) {
      throw new UrlValidationError(validation.reason);
    }

    const controller = new AbortController();
    const timeout = windowLikeSetTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(validation.url, {
        ...init,
        redirect: 'manual',
        signal: init.signal || controller.signal,
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

function getFetchTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env.PROXY_FETCH_TIMEOUT_MS || '',
    10,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_FETCH_TIMEOUT_MS;
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
    addresses = await lookup(hostname, { all: true, verbatim: true });
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

function isRedirectResponse(status: number): boolean {
  return status >= 300 && status < 400;
}

function isBlockedAddress(address: string): boolean {
  const normalized = normalizeIpAddress(address);
  const ipVersion = net.isIP(normalized);

  if (ipVersion === 4) {
    return isBlockedIpv4(normalized);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(normalized);
  }

  return false;
}

function normalizeIpAddress(address: string): string {
  const lower = normalizeHostname(address);
  if (lower.startsWith('::ffff:')) {
    return lower.slice('::ffff:'.length);
  }
  return lower;
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
