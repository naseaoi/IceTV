export const SOURCE_COVER_PROXY_MODES = ['auto', 'browser', 'server'] as const;

export type SourceCoverProxyMode = (typeof SOURCE_COVER_PROXY_MODES)[number];

export const DEFAULT_SOURCE_COVER_PROXY_MODE: SourceCoverProxyMode = 'auto';

const FAILED_HOSTS_STORAGE_KEY = 'icetv:source-cover-proxy-failed-hosts';
const MAX_FAILED_HOSTS = 100;
// 代理失败多为上游临时不可达，冷却后重新尝试服务端代理
export const SOURCE_COVER_PROXY_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

export const sourceCoverProxyModeOptions = [
  { value: 'auto', label: '自动（服务端失败后浏览器直连）' },
  { value: 'browser', label: '直连（浏览器请求）' },
  { value: 'server', label: '代理（服务器请求）' },
];

export function normalizeSourceCoverProxyMode(
  value: unknown,
): SourceCoverProxyMode {
  return SOURCE_COVER_PROXY_MODES.includes(value as SourceCoverProxyMode)
    ? (value as SourceCoverProxyMode)
    : DEFAULT_SOURCE_COVER_PROXY_MODE;
}

export function buildSourceCoverProxyUrl(originalUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
}

export function shouldProxySourceCover(
  originalUrl: string,
  mode: SourceCoverProxyMode,
): boolean {
  if (mode === 'browser') {
    return false;
  }

  const hostname = getRemoteHostname(originalUrl);
  if (!hostname) {
    return false;
  }

  return mode === 'server' || !readFailedHosts(Date.now()).has(hostname);
}

export function markSourceCoverProxyHostFailed(
  originalUrl: string,
  now = Date.now(),
): void {
  const hostname = getRemoteHostname(originalUrl);
  if (!hostname || typeof window === 'undefined') {
    return;
  }

  const hosts = readFailedHosts(now);
  hosts.delete(hostname);
  hosts.set(hostname, now);
  const trimmedHosts = Array.from(hosts).slice(-MAX_FAILED_HOSTS);

  try {
    window.sessionStorage.setItem(
      FAILED_HOSTS_STORAGE_KEY,
      JSON.stringify(trimmedHosts),
    );
  } catch {}
}

export function isSourceCoverProxyUrl(url: string): boolean {
  return url.startsWith('/api/image-proxy?');
}

function getRemoteHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function readFailedHosts(now: number): Map<string, number> {
  const hosts = new Map<string, number>();
  if (typeof window === 'undefined') {
    return hosts;
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(FAILED_HOSTS_STORAGE_KEY) || '[]',
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return hosts;
    }
    for (const item of parsed.slice(-MAX_FAILED_HOSTS)) {
      if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'number' &&
        now - item[1] < SOURCE_COVER_PROXY_FAILURE_COOLDOWN_MS
      ) {
        hosts.set(item[0], item[1]);
      }
    }
  } catch {}
  return hosts;
}
