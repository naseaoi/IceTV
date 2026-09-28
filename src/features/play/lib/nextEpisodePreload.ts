import { shouldFilterAdsOnClient } from '@/features/play/lib/ad-filter-strategy-registry';
import {
  type FragmentMemoryCache,
  type FragmentMemoryEntry,
  createFragmentEntryFromResponse,
  fragmentMemoryCache,
  FragmentMemoryCacheLoader,
  isCacheableFragmentUrl,
} from '@/features/play/lib/fragmentMemoryCache';
import { resolveLazyEpisodeUrl } from '@/features/play/lib/lazyEpisode';
import { filterAdsFromM3U8 } from '@/features/play/lib/playUtils';
import {
  buildVodProxyUrl,
  isVodM3u8Url,
} from '@/features/play/lib/vodProxyUrl';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { getManagedVideo } from '@/lib/player-runtime';
import { isServerProxy } from '@/lib/proxy-modes';

export const NEXT_EPISODE_PRELOAD_LIMITS = {
  remainingSeconds: 60,
  healthyBufferSeconds: 15,
  maxSegments: 3,
  maxBytes: 12 * 1024 * 1024,
  checkIntervalMs: 2_000,
} as const;

const BUFFER_TOLERANCE_SECONDS = 0.5;
const PLAYLIST_TIMEOUT_MS = 10_000;
const SEGMENT_TIMEOUT_MS = 20_000;
const PLAY_PAGE_PATH = '/play';

export type NextEpisodePreloadConditions = {
  autoPlayNext: boolean;
  currentTime: number;
  duration: number;
  // 跳过片尾时提前换集的秒数
  outroSeconds: number;
  bufferedAheadSeconds: number;
  saveData: boolean;
};

export function shouldStartNextEpisodePreload(
  conditions: NextEpisodePreloadConditions,
): boolean {
  const { autoPlayNext, currentTime, duration, saveData } = conditions;
  if (!autoPlayNext || saveData) return false;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (!Number.isFinite(currentTime)) return false;

  const mediaRemaining = duration - currentTime;
  const playbackRemaining =
    mediaRemaining - Math.max(0, conditions.outroSeconds || 0);
  if (
    playbackRemaining <= 0 ||
    playbackRemaining > NEXT_EPISODE_PRELOAD_LIMITS.remainingSeconds
  ) {
    return false;
  }
  // 当前集还没缓冲稳时不抢带宽；临近片尾时缓冲本身到不了阈值，按剩余时长放宽
  const requiredBuffer = Math.min(
    NEXT_EPISODE_PRELOAD_LIMITS.healthyBufferSeconds,
    mediaRemaining - BUFFER_TOLERANCE_SECONDS,
  );
  return conditions.bufferedAheadSeconds >= requiredBuffer;
}

type BufferedMedia = {
  currentTime: number;
  buffered: {
    length: number;
    start: (index: number) => number;
    end: (index: number) => number;
  };
};

export function getForwardBufferSeconds(media: BufferedMedia): number {
  const time = media.currentTime;
  const ranges = media.buffered;
  let end = -1;
  for (let index = 0; index < ranges.length; index += 1) {
    const rangeStart = ranges.start(index);
    const rangeEnd = ranges.end(index);
    if (end < 0) {
      if (rangeStart <= time + BUFFER_TOLERANCE_SECONDS && rangeEnd > time) {
        end = rangeEnd;
      }
    } else if (rangeStart - end <= BUFFER_TOLERANCE_SECONDS) {
      end = Math.max(end, rangeEnd);
    } else {
      break;
    }
  }
  return end < 0 ? 0 : end - time;
}

function resolvePlaylistUrl(line: string, baseUrl: string): string | null {
  if (/^https?:\/\//i.test(line)) return line;
  try {
    return new URL(line, baseUrl).toString();
  } catch {
    return null;
  }
}

export function isMasterPlaylist(content: string): boolean {
  return /#EXT-X-STREAM-INF:/i.test(content);
}

/** 单码率直接用；多码率选与当前档位带宽最接近的一档，拿不到当前档位时不猜。 */
export function selectPreloadVariantUrl(
  content: string,
  baseUrl: string,
  targetBitrate: number | null,
): string | null {
  const lines = content.split('\n').map((line) => line.trim());
  const variants: Array<{ url: string; bandwidth: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].toUpperCase().startsWith('#EXT-X-STREAM-INF:')) continue;
    const uri = lines[index + 1];
    if (!uri || uri.startsWith('#')) continue;
    const url = resolvePlaylistUrl(uri, baseUrl);
    const bandwidth = Number(/[:,]BANDWIDTH=(\d+)/i.exec(lines[index])?.[1]);
    if (url) {
      variants.push({ url, bandwidth: bandwidth > 0 ? bandwidth : 0 });
    }
  }

  if (variants.length <= 1) return variants[0]?.url ?? null;
  if (!targetBitrate || targetBitrate <= 0) return null;
  let best = variants[0];
  for (const variant of variants) {
    if (
      Math.abs(variant.bandwidth - targetBitrate) <
      Math.abs(best.bandwidth - targetBitrate)
    ) {
      best = variant;
    }
  }
  return best.url;
}

/**
 * 选出新一集起播最先请求的分片：播放器总是先加载第 0 片，
 * 开启跳过片头时随后跳到片头结束处，因此再补上该位置起的连续分片。
 */
export function selectPreloadSegmentUrls(
  content: string,
  baseUrl: string,
  startOffsetSeconds: number,
  maxCount: number = NEXT_EPISODE_PRELOAD_LIMITS.maxSegments,
): string[] {
  // 字节范围分片不走内存缓存
  if (/#EXT-X-BYTERANGE/i.test(content)) return [];

  const segments: Array<{ url: string | null; end: number }> = [];
  let pendingDuration: number | null = null;
  let position = 0;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.toUpperCase().startsWith('#EXTINF:')) {
      const duration = Number.parseFloat(line.slice('#EXTINF:'.length));
      pendingDuration =
        Number.isFinite(duration) && duration > 0 ? duration : 0;
      continue;
    }
    if (line.startsWith('#') || pendingDuration === null) continue;
    position += pendingDuration;
    segments.push({ url: resolvePlaylistUrl(line, baseUrl), end: position });
    pendingDuration = null;
  }
  if (segments.length === 0 || maxCount <= 0) return [];

  const offset = startOffsetSeconds > 0 ? startOffsetSeconds : 0;
  const offsetIndex = segments.findIndex((segment) => segment.end > offset);
  const indices = [0];
  for (
    let index = Math.max(offsetIndex, 1);
    index < segments.length && indices.length < maxCount;
    index += 1
  ) {
    indices.push(index);
  }
  return indices
    .map((index) => segments[index].url)
    .filter((url): url is string => isCacheableFragmentUrl(url));
}

type PreloadResponse = {
  ok: boolean;
  status: number;
  url?: string;
  headers?: { get: (name: string) => string | null } | null;
  body?: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type PreloadFetcher = (
  url: string,
  init: RequestInit,
) => Promise<PreloadResponse>;

const defaultFetcher: PreloadFetcher = (url, init) => fetch(url, init);

async function discardBody(response: PreloadResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 丢弃响应体失败不影响后续逻辑
  }
}

async function loadPlaylist(
  url: string,
  fetcher: PreloadFetcher,
  signal: AbortSignal,
): Promise<{ url: string; text: string } | null> {
  const timed = createTimedAbortController(signal, PLAYLIST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      signal: timed.signal,
    });
    if (!response.ok) {
      await discardBody(response);
      return null;
    }
    return { url: response.url || url, text: await response.text() };
  } catch {
    return null;
  } finally {
    timed.cleanup();
  }
}

async function readBodyWithLimit(
  response: PreloadResponse,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return buffer.byteLength <= maxBytes ? new Uint8Array(buffer) : null;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function loadSegmentEntry(
  url: string,
  fetcher: PreloadFetcher,
  signal: AbortSignal,
  maxBytes: number,
): Promise<FragmentMemoryEntry | null> {
  const timed = createTimedAbortController(signal, SEGMENT_TIMEOUT_MS);
  try {
    const startedAt = performance.now();
    const response = await fetcher(url, {
      mode: 'cors',
      credentials: 'same-origin',
      signal: timed.signal,
    });
    const respondedAt = performance.now();
    const declaredBytes = Number(response.headers?.get('content-length'));
    if (!response.ok || declaredBytes > maxBytes) {
      await discardBody(response);
      return null;
    }
    const data = await readBodyWithLimit(response, maxBytes);
    if (!data) return null;
    return createFragmentEntryFromResponse(response, data, {
      streamEnded: true,
      requestedBytes: null,
      ttfbMs: respondedAt - startedAt,
      transferMs: performance.now() - respondedAt,
    });
  } catch {
    return null;
  } finally {
    timed.cleanup();
  }
}

export type PreloadEpisodeFragmentsOptions = {
  sourceKey: string;
  episodeUrl: string;
  targetBitrate: number | null;
  startOffsetSeconds: number;
  filterAds: boolean;
  signal: AbortSignal;
  cache?: FragmentMemoryCache;
  fetcher?: PreloadFetcher;
};

/** 按播放器同样的线路取下一集清单，把起播最先请求的几个分片整片写入内存缓存，返回写入条数。 */
export async function preloadEpisodeFragments(
  options: PreloadEpisodeFragmentsOptions,
): Promise<number> {
  const { sourceKey, signal } = options;
  const cache = options.cache ?? fragmentMemoryCache;
  const fetcher = options.fetcher ?? defaultFetcher;

  const resolvedUrl = await resolveLazyEpisodeUrl(
    sourceKey,
    options.episodeUrl,
  );
  if (signal.aborted || !isVodM3u8Url(resolvedUrl)) return 0;

  const manifestUrl = new URL(
    buildVodProxyUrl({
      rawUrl: resolvedUrl,
      useServerProxy: isServerProxy(sourceKey, resolvedUrl),
      sourceKey,
      playbackRequestMode: 'episode',
    }),
    window.location.href,
  ).toString();
  let playlist = await loadPlaylist(manifestUrl, fetcher, signal);
  if (playlist && isMasterPlaylist(playlist.text)) {
    const variantUrl = selectPreloadVariantUrl(
      playlist.text,
      playlist.url,
      options.targetBitrate,
    );
    playlist = variantUrl
      ? await loadPlaylist(variantUrl, fetcher, signal)
      : null;
  }
  if (!playlist || signal.aborted) return 0;

  const mediaText = options.filterAds
    ? filterAdsFromM3U8(playlist.text)
    : playlist.text;
  const segmentUrls = selectPreloadSegmentUrls(
    mediaText,
    playlist.url,
    options.startOffsetSeconds,
  );

  let usedBytes = 0;
  let stored = 0;
  for (const url of segmentUrls) {
    if (signal.aborted) break;
    if (cache.has(url)) continue;
    const entry = await loadSegmentEntry(
      url,
      fetcher,
      signal,
      NEXT_EPISODE_PRELOAD_LIMITS.maxBytes - usedBytes,
    );
    if (!entry || !entry.complete || signal.aborted) break;
    usedBytes += entry.data.byteLength;
    if (cache.put(url, entry)) stored += 1;
  }
  return stored;
}

type RefLike<T> = { readonly current: T };

type SkipConfigLike = {
  enable: boolean;
  intro_time: number;
  outro_time: number;
};

type HlsLike = {
  config?: { fLoader?: unknown } | null;
  levels?: Array<{ bitrate?: number; maxBitrate?: number }> | null;
  loadLevel?: number;
  currentLevel?: number;
};

export type NextEpisodePreloadOptions = {
  sourceKey: string;
  videoId: string;
  episodeIndex: number;
  nextEpisodeUrl: string | null;
  getVideo: () => HTMLVideoElement | null | undefined;
  detailRef: RefLike<{ source?: string; id?: string } | null>;
  currentEpisodeIndexRef: RefLike<number>;
  autoPlayNextEnabledRef: RefLike<boolean>;
  blockAdEnabledRef: RefLike<boolean>;
  skipConfigRef: RefLike<SkipConfigLike | null>;
};

type PreloadSession = {
  key: string;
  options: NextEpisodePreloadOptions & { nextEpisodeUrl: string };
  timer: ReturnType<typeof setInterval> | null;
  controller: AbortController | null;
};

let activeSession: PreloadSession | null = null;

function getHlsLevelBitrate(hls: HlsLike): number | null {
  const levels = hls.levels || [];
  for (const index of [hls.loadLevel, hls.currentLevel]) {
    const level =
      typeof index === 'number' && index >= 0 ? levels[index] : undefined;
    const bitrate = level?.maxBitrate || level?.bitrate || 0;
    if (bitrate > 0) return bitrate;
  }
  return null;
}

function isSaveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return connection?.saveData === true;
}

function checkPreloadSession(session: PreloadSession): void {
  if (activeSession !== session || session.timer === null) return;
  const { options } = session;
  const detail = options.detailRef.current;
  if (
    options.currentEpisodeIndexRef.current !== options.episodeIndex ||
    detail?.source !== options.sourceKey ||
    detail?.id !== options.videoId ||
    window.location.pathname !== PLAY_PAGE_PATH
  ) {
    cancelNextEpisodePreload();
    return;
  }
  // 播放器重建期间会短暂拿不到 video，留到下一轮再检查
  const video = options.getVideo();
  if (!video) return;

  const hls: HlsLike | null = getManagedVideo(video).hls ?? null;
  // 内存分片只由 hls.js 的 fLoader 消费，未接入时预载只会白占带宽
  if (!hls || hls.config?.fLoader !== FragmentMemoryCacheLoader) return;

  const skip = options.skipConfigRef.current?.enable
    ? options.skipConfigRef.current
    : null;
  const shouldStart = shouldStartNextEpisodePreload({
    autoPlayNext: options.autoPlayNextEnabledRef.current,
    currentTime: video.currentTime,
    duration: video.duration,
    outroSeconds: skip && skip.outro_time < 0 ? -skip.outro_time : 0,
    bufferedAheadSeconds: getForwardBufferSeconds(video),
    saveData: isSaveDataEnabled(),
  });
  if (!shouldStart) return;

  // 每集只触发一次
  clearInterval(session.timer);
  session.timer = null;
  const controller = new AbortController();
  session.controller = controller;
  void preloadEpisodeFragments({
    sourceKey: options.sourceKey,
    episodeUrl: options.nextEpisodeUrl,
    targetBitrate: getHlsLevelBitrate(hls),
    startOffsetSeconds: skip && skip.intro_time > 0 ? skip.intro_time : 0,
    filterAds:
      options.blockAdEnabledRef.current &&
      shouldFilterAdsOnClient(options.sourceKey),
    signal: controller.signal,
  })
    .catch(() => 0)
    .finally(() => {
      if (session.controller === controller) session.controller = null;
    });
}

export function cancelNextEpisodePreload(): void {
  const session = activeSession;
  activeSession = null;
  if (!session) return;
  if (session.timer !== null) clearInterval(session.timer);
  session.timer = null;
  session.controller?.abort();
  session.controller = null;
}

/**
 * 每次进入一集时调用：换集、换源或下一集变化时取消旧会话；同一集重复调用保持原状态，
 * 保证每集最多预载一次。
 */
export function scheduleNextEpisodePreload(
  options: NextEpisodePreloadOptions,
): void {
  const { nextEpisodeUrl } = options;
  const key = nextEpisodeUrl
    ? [
        options.sourceKey,
        options.videoId,
        options.episodeIndex,
        nextEpisodeUrl,
      ].join('\n')
    : '';
  if (nextEpisodeUrl && activeSession?.key === key) {
    activeSession.options = { ...options, nextEpisodeUrl };
    return;
  }

  cancelNextEpisodePreload();
  if (!nextEpisodeUrl || typeof window === 'undefined') return;
  const session: PreloadSession = {
    key,
    options: { ...options, nextEpisodeUrl },
    timer: null,
    controller: null,
  };
  session.timer = setInterval(
    () => checkPreloadSession(session),
    NEXT_EPISODE_PRELOAD_LIMITS.checkIntervalMs,
  );
  activeSession = session;
}
