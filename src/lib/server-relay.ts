export const SERVER_RELAY_PAUSED_HEADER = 'x-icetv-relay-paused';

function readResponseHeader(details: unknown, name: string): string | null {
  if (!details || typeof details !== 'object') return null;
  const xhr = details as { getResponseHeader?: (name: string) => unknown };
  if (typeof xhr.getResponseHeader === 'function') {
    try {
      const value = xhr.getResponseHeader(name);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  const headers = (details as { headers?: { get?: (name: string) => unknown } })
    .headers;
  if (typeof headers?.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' ? value : null;
  }
  return null;
}

// hls.js 错误里 networkDetails 是 XHR 或 fetch Response，两种都要读响应头
export function isServerRelayPausedHlsError(data: unknown): boolean {
  const details = (data as { networkDetails?: unknown } | null)?.networkDetails;
  return readResponseHeader(details, SERVER_RELAY_PAUSED_HEADER) === '1';
}
