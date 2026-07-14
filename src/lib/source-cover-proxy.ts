export const SOURCE_COVER_PROXY_MODES = ['auto', 'browser', 'server'] as const;

export type SourceCoverProxyMode = (typeof SOURCE_COVER_PROXY_MODES)[number];

export const DEFAULT_SOURCE_COVER_PROXY_MODE: SourceCoverProxyMode = 'auto';

const FAILED_HOSTS_STORAGE_KEY = 'icetv:source-cover-proxy-failed-hosts';
const MAX_FAILED_HOSTS = 100;

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

  return mode === 'server' || !readFailedHosts().has(hostname);
}

export function markSourceCoverProxyHostFailed(originalUrl: string): void {
  const hostname = getRemoteHostname(originalUrl);
  if (!hostname || typeof window === 'undefined') {
    return;
  }

  const hosts = readFailedHosts();
  hosts.delete(hostname);
  hosts.add(hostname);
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

function readFailedHosts(): Set<string> {
  if (typeof window === 'undefined') {
    return new Set();
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(FAILED_HOSTS_STORAGE_KEY) || '[]',
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed
        .filter((host): host is string => typeof host === 'string')
        .slice(-MAX_FAILED_HOSTS),
    );
  } catch {
    return new Set();
  }
}
