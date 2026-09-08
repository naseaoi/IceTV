import {
  SOURCE_PROBE_HEADER,
  SourceProbeDeferredError,
} from '@/features/play/lib/sourceProbeRequestPolicy';

let cooldownUntil = 0;

function isLocalRequest(url: string): boolean {
  if (url.startsWith('/api/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function fetchSourceProbe(
  url: string,
  init: Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  if (!isLocalRequest(url)) return fetch(url, init);
  if (Date.now() < cooldownUntil) {
    throw new SourceProbeDeferredError(
      Math.ceil((cooldownUntil - Date.now()) / 1000),
    );
  }
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, [SOURCE_PROBE_HEADER]: '1' },
  });
  if (response.status === 429 || response.status === 503) {
    const retryAfter = Number(response.headers?.get('Retry-After'));
    const seconds =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(60, Math.ceil(retryAfter))
        : 2;
    cooldownUntil = Date.now() + seconds * 1000;
    await response.body?.cancel().catch(() => {});
    throw new SourceProbeDeferredError(seconds);
  }
  return response;
}
