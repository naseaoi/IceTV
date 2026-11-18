import {
  createSharedPlaybackTask,
  playbackAbortError,
} from '@/features/play/lib/sharedPlaybackTask';
import { fetchSourceProbe } from '@/features/play/lib/sourceProbeRequest';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import {
  getSignedUrlFreshMs,
  hasSignedUrlParams,
} from '@/lib/signed-url-params';

const RESOLVED_CACHE_TTL_MS = 30 * 60 * 1000;
const RESOLVED_CACHE_MAX_SIZE = 200;

const resolvedCache = new Map<
  string,
  { url: string; expiresAt: number; refreshed: boolean }
>();
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
  if (Date.now() >= entry.expiresAt) {
    resolvedCache.delete(key);
    return null;
  }
  return entry.url;
}

async function requestEpisodeUrl(
  source: string,
  lazyUrl: string,
  probe: boolean,
  forceRefresh: boolean,
  signal: AbortSignal,
): Promise<string> {
  const response = await (probe ? fetchSourceProbe : fetch)(
    `/api/episode-url?source=${encodeURIComponent(source)}&url=${encodeURIComponent(lazyUrl)}${forceRefresh ? '&refresh=1' : ''}`,
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
  options: {
    probe?: boolean;
    signal?: AbortSignal;
    forceRefresh?: boolean;
  } = {},
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(playbackAbortError());
  if (!isLazyEpisodeUrl(lazyUrl)) {
    return Promise.resolve(lazyUrl);
  }

  const key = buildCacheKey(source, lazyUrl);
  const refreshKey = `${key}:refresh`;
  const refreshing = inflight.get(refreshKey);
  if (refreshing && !refreshing.signal.aborted)
    return refreshing.consume(options.signal);

  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh) {
    const cached = peekResolvedLazyEpisodeUrl(source, lazyUrl);
    if (cached) return Promise.resolve(cached);
  }

  const cachedAtStart = resolvedCache.get(key);
  const inflightKey = forceRefresh
    ? refreshKey
    : `${key}:${options.probe ? 'probe' : 'playback'}`;
  const pending = inflight.get(inflightKey);
  if (pending && !pending.signal.aborted)
    return pending.consume(options.signal);

  const task = createSharedPlaybackTask(async (signal) => {
    try {
      const url = await requestEpisodeUrl(
        source,
        lazyUrl,
        options.probe === true && !forceRefresh,
        forceRefresh,
        signal,
      );
      if (signal.aborted) throw playbackAbortError();
      // 旧的预热或测速请求不能覆盖已经启动或完成的强刷。
      const current = resolvedCache.get(key);
      if (
        !forceRefresh &&
        (inflight.has(refreshKey) ||
          (current?.refreshed && current !== cachedAtStart))
      )
        return url;
      const now = Date.now();
      const freshMs = hasSignedUrlParams(url)
        ? getSignedUrlFreshMs(url, now)
        : RESOLVED_CACHE_TTL_MS;
      resolvedCache.set(key, {
        url,
        expiresAt: now + freshMs,
        refreshed: forceRefresh,
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
