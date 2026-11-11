import {
  createSharedPlaybackTask,
  playbackAbortError,
} from '@/features/play/lib/sharedPlaybackTask';
import { fetchSourceProbe } from '@/features/play/lib/sourceProbeRequest';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';

const RESOLVED_CACHE_TTL_MS = 30 * 60 * 1000;
const RESOLVED_CACHE_MAX_SIZE = 200;

const resolvedCache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<
  string,
  ReturnType<typeof createSharedPlaybackTask<string>>
>();

function buildCacheKey(source: string, lazyUrl: string): string {
  return `${source}::${lazyUrl}`;
}

export function peekResolvedLazyEpisodeUrl(
  source: string,
  lazyUrl: string,
): string | null {
  const key = buildCacheKey(source, lazyUrl);
  const entry = resolvedCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resolvedCache.delete(key);
    return null;
  }
  return entry.url;
}

async function requestEpisodeUrl(
  source: string,
  lazyUrl: string,
  probe: boolean,
  signal: AbortSignal,
): Promise<string> {
  const response = await (probe ? fetchSourceProbe : fetch)(
    `/api/episode-url?source=${encodeURIComponent(source)}&url=${encodeURIComponent(lazyUrl)}`,
    { signal },
  );
  if (!response.ok) {
    const message = await response
      .json()
      .then((data) => (data as { error?: string })?.error)
      .catch(() => null);
    throw new Error(message || '播放地址解析失败');
  }
  const data = (await response.json()) as { url?: unknown };
  if (typeof data.url !== 'string' || !data.url) {
    throw new Error('播放地址解析失败');
  }
  return data.url;
}

export function resolveLazyEpisodeUrl(
  source: string,
  lazyUrl: string,
  options: { probe?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(playbackAbortError());
  if (!isLazyEpisodeUrl(lazyUrl)) {
    return Promise.resolve(lazyUrl);
  }

  const key = buildCacheKey(source, lazyUrl);
  const cached = peekResolvedLazyEpisodeUrl(source, lazyUrl);
  if (cached) return Promise.resolve(cached);

  const inflightKey = `${key}:${options.probe ? 'probe' : 'playback'}`;
  const pending = inflight.get(inflightKey);
  if (pending && !pending.signal.aborted)
    return pending.consume(options.signal);

  const task = createSharedPlaybackTask(async (signal) => {
    try {
      const url = await requestEpisodeUrl(
        source,
        lazyUrl,
        options.probe === true,
        signal,
      );
      if (signal.aborted) throw playbackAbortError();
      resolvedCache.set(key, {
        url,
        expiresAt: Date.now() + RESOLVED_CACHE_TTL_MS,
      });
      if (resolvedCache.size > RESOLVED_CACHE_MAX_SIZE) {
        const oldest = resolvedCache.keys().next().value;
        if (oldest) resolvedCache.delete(oldest);
      }
      return url;
    } finally {
      if (inflight.get(inflightKey) === task) inflight.delete(inflightKey);
    }
  });
  inflight.set(inflightKey, task);
  return task.consume(options.signal);
}

export function prewarmLazyEpisodeUrl(
  source: string,
  lazyUrl: string,
  signal?: AbortSignal,
): void {
  if (!isLazyEpisodeUrl(lazyUrl)) return;
  void resolveLazyEpisodeUrl(source, lazyUrl, { signal }).catch(
    () => undefined,
  );
}
