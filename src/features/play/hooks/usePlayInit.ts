import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useRef,
} from 'react';

import type {
  SourceRecommendation,
  VideoQualityInfo,
} from '@/features/play/hooks/usePlayPageState';
import {
  type HistoryRestoreGate,
  peekHistoryRestoreEpisodeIndex,
  waitForHistoryRestore,
} from '@/features/play/hooks/usePlayProgress';
import {
  readDetailSnapshot,
  saveDetailSnapshot,
} from '@/features/play/lib/detailSnapshot';
import { fragmentMemoryCache } from '@/features/play/lib/fragmentMemoryCache';
import {
  type ProbeSegmentSample,
  checkM3u8PlaylistAvailable,
  takeProbeSegmentSample,
} from '@/features/play/lib/hls-utils';
import {
  peekResolvedLazyEpisodeUrl,
  resolveLazyEpisodeUrl,
} from '@/features/play/lib/lazyEpisode';
import { replacePlayPageUrl } from '@/features/play/lib/playPageUrl';
import { calculateSourceScore } from '@/features/play/lib/playUtils';
import {
  SOURCE_PROBE_CONCURRENCY,
  SourceProbeDeferredError,
} from '@/features/play/lib/sourceProbeRequestPolicy';
import {
  type SourceSelectionContext,
  compareSourceRoutePreference,
  preferDirectRouteSources,
} from '@/features/play/lib/sourceRoutePreference';
import { getSourceSelectionContext } from '@/features/play/lib/sourceSelectionContext';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import {
  buildVodProxyUrl,
  isVodM3u8Url,
} from '@/features/play/lib/vodProxyUrl';
import { withTimeout } from '@/lib/concurrency';
import {
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
} from '@/lib/db.client';
import { remapEpisodeIndexToDetail } from '@/lib/episode-groups';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import { PLAYER_EXIT_EVENT } from '@/lib/navigation-return';
import { hasMatchingPlayIntent } from '@/lib/play-intent';
import { prefetchM3U8 } from '@/lib/player-runtime';
import { shouldUseServerProxy } from '@/lib/proxy-modes';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { filterSourcesForPlayback } from '@/lib/source-match';
import {
  isTrustedSourcePlaybackStat,
  readSourcePlaybackStats,
  sortSourcesByPlaybackStats,
} from '@/lib/source-playback-stats';
import { PlayRecord, SearchResult } from '@/lib/types';

const DETAIL_CACHE_TTL_MS = 3 * 60 * 1000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const SOURCE_PROBE_FOREGROUND_LIMIT = SOURCE_PROBE_CONCURRENCY;
// 可信源直接起播后推迟后台测速，避免与起播争抢带宽
const TRUSTED_SOURCE_BACKGROUND_PROBE_DELAY_MS = 5_000;
const TRUSTED_SOURCE_PLAYLIST_CHECK_TIMEOUT_MS = 3_000;
// 起播等历史恢复的上限：播放记录接口正常远在此内返回；超时按当前集起播，记录迟到时照旧由历史恢复换集
const HISTORY_RESTORE_WAIT_TIMEOUT_MS = 1_000;
const detailCache = new Map<
  string,
  { data: SearchResult; expiresAt: number }
>();

function getCachedDetail(source: string, id: string): SearchResult | null {
  if (IS_DEVELOPMENT) {
    return null;
  }

  const key = `${source}::${id}`;
  const entry = detailCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    detailCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedDetail(source: string, id: string, data: SearchResult) {
  if (IS_DEVELOPMENT) {
    return;
  }

  const key = `${source}::${id}`;
  detailCache.set(key, { data, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
  if (detailCache.size > 100) {
    const oldest = detailCache.keys().next().value;
    if (oldest) detailCache.delete(oldest);
  }
}

type SourceProbeResult = {
  source: SearchResult;
  testResult: VideoQualityInfo;
};

function getSourceKey(source: Pick<SearchResult, 'source' | 'id'>) {
  return `${source.source}-${source.id}`;
}

// 与 finalizePlaybackDetail 的越界回退一致：请求的集不存在时从第 1 集起播
function resolveTargetEpisodeIndex(
  episodeCount: number,
  requestedEpisodeIndex: number,
): number {
  return Number.isInteger(requestedEpisodeIndex) &&
    requestedEpisodeIndex >= 0 &&
    requestedEpisodeIndex < episodeCount
    ? requestedEpisodeIndex
    : 0;
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function scoreProbeResults(results: SourceProbeResult[]) {
  const validSpeeds = results
    .map((result) => {
      const match = result.testResult.loadSpeed.match(
        /^([\d.]+)\s*(Mbps|KB\/s|MB\/s)$/,
      );
      if (!match) return 0;
      const value = parseFloat(match[1]);
      const unit = match[2];
      if (unit === 'Mbps') return (value * 1024) / 8;
      return unit === 'MB/s' ? value * 1024 : value;
    })
    .filter((speed) => speed > 0);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;
  const validPings = results
    .map((result) => result.testResult.pingTime)
    .filter((ping) => ping > 0);
  const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
  const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

  return results
    .map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing,
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

async function preferBestSource(
  sources: SearchResult[],
  getRequestedEpisodeIndex: (source: SearchResult) => number,
  getActiveSourceKey: () => string,
  getPlayingSourceKey: () => string,
  setPrecomputedVideoInfo: Dispatch<
    SetStateAction<Map<string, VideoQualityInfo>>
  >,
  setSourceRecommendation: Dispatch<
    SetStateAction<SourceRecommendation | null>
  >,
  selectionContext: SourceSelectionContext,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (sources.length === 1) return sources[0];

  setSourceRecommendation(null);
  const { proxyModes } = selectionContext;
  if (signal?.aborted) return sources[0];

  const playbackStats = readSourcePlaybackStats();
  const now = Date.now();
  const comparePriority = (a: SearchResult, b: SearchResult) =>
    compareSourceRoutePreference(a, b, selectionContext, playbackStats, now);
  const candidates = preferDirectRouteSources(
    sortSourcesByPlaybackStats(
      sources,
      (source) => source.source,
      playbackStats,
      now,
    ),
    selectionContext,
    playbackStats,
    now,
  );
  const collectedResults: SourceProbeResult[] = [];
  const failedSourceKeys = new Set<string>();
  let selectedKey = '';
  // 选中前各源按自己续播的集测；选中后换源沿用选中源的集，备选预取和后台测速都按这一集
  let selectedEpisodeIndex: number | null = null;
  let recommendedKey = '';
  // 首分片样本只留给最终选中的源起播复用：决策前暂存，决策后到达的样本直接丢弃
  const pendingSamples = new Map<string, ProbeSegmentSample>();
  let samplesSettled = false;

  const settleProbeSamples = (target: SearchResult | null) => {
    samplesSettled = true;
    const sample = target
      ? pendingSamples.get(getSourceKey(target))
      : undefined;
    pendingSamples.clear();
    if (sample) {
      fragmentMemoryCache.put(sample.url, sample.entry);
    }
  };

  const getTargetEpisodeUrl = (source: SearchResult): string | undefined => {
    const episodes = source.episodes || [];
    return episodes[
      resolveTargetEpisodeIndex(
        episodes.length,
        selectedEpisodeIndex ?? getRequestedEpisodeIndex(source),
      )
    ];
  };

  const selectSource = (source: SearchResult) => {
    selectedKey = getSourceKey(source);
    selectedEpisodeIndex = resolveTargetEpisodeIndex(
      (source.episodes || []).length,
      getRequestedEpisodeIndex(source),
    );
  };

  const writeProbeInfo = (source: SearchResult, info: VideoQualityInfo) => {
    const key = getSourceKey(source);
    setPrecomputedVideoInfo((prev) => {
      const next = new Map(prev);
      next.set(key, info);
      return next;
    });
  };

  const notifyBetterSource = () => {
    if (!selectedKey) return;
    // 起播后页面可能已手动或自动换源，按页面当前的源判断；页面还没有当前源时以选中源为准
    const activeKey = getActiveSourceKey() || selectedKey;
    const scored = scoreProbeResults(
      candidates.flatMap((source) => {
        const result = collectedResults.find((item) => item.source === source);
        return result ? [result] : [];
      }),
    ).sort((a, b) => comparePriority(a.source, b.source) || b.score - a.score);
    const best = scored[0];
    if (!best) return;
    const bestKey = getSourceKey(best.source);
    // 选中源同样不推荐：页面从它换走后不推荐换回，页面提交选中源之前当前源也可能还是链接里带的源
    if (bestKey === activeKey || bestKey === selectedKey) return;
    if (bestKey === recommendedKey) return;
    // 当前源测出失败时不必比分，直接推荐测通的最优源
    if (!failedSourceKeys.has(activeKey)) {
      const active = scored.find(
        (item) => getSourceKey(item.source) === activeKey,
      );
      if (
        !active ||
        (comparePriority(best.source, active.source) ||
          active.score - best.score) >= 0
      )
        return;
    }

    recommendedKey = bestKey;
    setSourceRecommendation({
      sourceName: best.source.source_name || best.source.source || '更优源',
      quality: best.testResult.quality,
      loadSpeed: best.testResult.loadSpeed,
    });
  };

  const probeSource = async (
    source: SearchResult,
  ): Promise<SourceProbeResult | null> => {
    if (signal?.aborted) return null;
    // 已真实起播的当前源不再下载样本测速：面板沿用播放器上报的实测信息，也不会因此记失败并推荐换源
    if (getSourceKey(source) === getPlayingSourceKey()) return null;
    const episodeUrl = getTargetEpisodeUrl(source);
    if (!episodeUrl) {
      failedSourceKeys.add(getSourceKey(source));
      writeProbeInfo(source, {
        quality: '未知',
        loadSpeed: '未知',
        pingTime: 0,
        hasError: true,
      });
      return null;
    }

    try {
      const useProxy = shouldUseServerProxy(
        source.source,
        episodeUrl,
        proxyModes,
      );
      const testResult = await probeVodEpisodeUrl(
        episodeUrl,
        useProxy,
        source.source,
      );
      const sample = takeProbeSegmentSample(testResult);
      if (signal?.aborted) return null;
      if (sample && !samplesSettled) {
        pendingSamples.set(getSourceKey(source), sample);
      }
      const result = { source, testResult };
      collectedResults.push(result);
      writeProbeInfo(source, testResult);
      notifyBetterSource();
      return result;
    } catch (error) {
      if (!signal?.aborted && !(error instanceof SourceProbeDeferredError)) {
        failedSourceKeys.add(getSourceKey(source));
        writeProbeInfo(source, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        });
      }
      return null;
    }
  };

  // 与播放器同样携带线路与源标识，服务端清单缓存按源分区，缺参数会落到另一份缓存
  const buildPlaybackPlaylistUrl = (source: SearchResult, episodeUrl: string) =>
    buildVodProxyUrl({
      rawUrl: episodeUrl,
      useServerProxy: shouldUseServerProxy(
        source.source,
        episodeUrl,
        proxyModes,
      ),
      sourceKey: source.source,
      playbackRequestMode: 'initial',
    });

  // 可信按站点统计，这部片在该站仍可能是死链：直接起播前限时只取一次清单，不通就回到常规测速
  const isTargetPlaylistAvailable = async (
    source: SearchResult,
  ): Promise<boolean> => {
    const rawUrl = getTargetEpisodeUrl(source);
    if (!rawUrl) return false;
    const deadline = Date.now() + TRUSTED_SOURCE_PLAYLIST_CHECK_TIMEOUT_MS;
    try {
      const episodeUrl = isLazyEpisodeUrl(rawUrl)
        ? await withTimeout(
            resolveLazyEpisodeUrl(source.source, rawUrl, { probe: true }),
            TRUSTED_SOURCE_PLAYLIST_CHECK_TIMEOUT_MS,
            'Episode url resolve timeout',
          )
        : rawUrl;
      const remainingMs = deadline - Date.now();
      return (
        remainingMs > 0 &&
        isVodM3u8Url(episodeUrl) &&
        (await checkM3u8PlaylistAvailable(
          buildPlaybackPlaylistUrl(source, episodeUrl),
          remainingMs,
        ))
      );
    } catch {
      return false;
    }
  };

  const prefetchRunnerUp = (winner: SearchResult) => {
    const winnerKey = getSourceKey(winner);
    const runnerUp = candidates.find((source) => {
      const key = getSourceKey(source);
      return (
        key !== winnerKey &&
        !failedSourceKeys.has(key) &&
        !!getTargetEpisodeUrl(source)
      );
    });
    const rawUrl = runnerUp ? getTargetEpisodeUrl(runnerUp) : undefined;
    if (!runnerUp || !rawUrl) return;
    const episodeUrl = isLazyEpisodeUrl(rawUrl)
      ? peekResolvedLazyEpisodeUrl(runnerUp.source, rawUrl)
      : rawUrl;
    if (!episodeUrl || !isVodM3u8Url(episodeUrl)) return;
    prefetchM3U8(buildPlaybackPlaylistUrl(runnerUp, episodeUrl));
  };

  const probeBatchUntilSuccess = async (
    batch: SearchResult[],
  ): Promise<SourceProbeResult | null> => {
    if (batch.length === 0) return null;

    return new Promise((resolve) => {
      let pending = batch.length;
      let resolved = false;

      batch.forEach((source) => {
        probeSource(source)
          .then((result) => {
            if (result && !resolved) {
              resolved = true;
              selectSource(result.source);
              resolve(result);
            }
          })
          .finally(() => {
            pending -= 1;
            if (pending === 0 && !resolved) {
              resolve(null);
            }
          });
      });
    });
  };

  const probeRemainingSources = async (remainingSources: SearchResult[]) => {
    for (
      let start = 0;
      start < remainingSources.length && !signal?.aborted;
      start += SOURCE_PROBE_FOREGROUND_LIMIT
    ) {
      const batch = remainingSources.slice(
        start,
        start + SOURCE_PROBE_FOREGROUND_LIMIT,
      );
      await Promise.all(batch.map((source) => probeSource(source)));
    }
  };

  // 近期稳定起播过且有目标集的常用源，目标集清单可用时直接起播，测速推迟到后台只用于换源推荐
  const trustedSource = candidates.find(
    (source) =>
      isTrustedSourcePlaybackStat(playbackStats.get(source.source)) &&
      !!source.episodes?.[getRequestedEpisodeIndex(source)],
  );
  if (
    trustedSource &&
    comparePriority(trustedSource, candidates[0]) === 0 &&
    (await isTargetPlaylistAvailable(trustedSource)) &&
    !signal?.aborted
  ) {
    selectSource(trustedSource);
    settleProbeSamples(null);
    prefetchRunnerUp(trustedSource);
    void (async () => {
      await waitForDelay(TRUSTED_SOURCE_BACKGROUND_PROBE_DELAY_MS, signal);
      if (signal?.aborted) return;
      await probeSource(trustedSource);
      await probeRemainingSources(
        candidates.filter((source) => source !== trustedSource),
      );
    })();
    return trustedSource;
  }

  // 同优先级内仍并发抢先起播；跨等级或线路分批，避免中转源抢先完成而绕过偏好。
  for (let start = 0; start < candidates.length && !signal?.aborted; ) {
    const batch = candidates
      .slice(start, start + SOURCE_PROBE_FOREGROUND_LIMIT)
      .filter((source) => comparePriority(source, candidates[start]) === 0);
    const result = await probeBatchUntilSuccess(batch);
    start += batch.length;
    if (result) {
      settleProbeSamples(result.source);
      void probeRemainingSources(candidates.slice(start));
      prefetchRunnerUp(result.source);
      return result.source;
    }
  }

  settleProbeSamples(null);
  return candidates[0];
}
export function updateVideoUrl(
  detailData: SearchResult | null,
  episodeIndex: number,
  currentVideoUrl: string,
  setVideoUrl: Dispatch<SetStateAction<string>>,
) {
  if (
    !detailData ||
    !detailData.episodes ||
    episodeIndex >= detailData.episodes.length
  ) {
    setVideoUrl('');
    return;
  }
  const newUrl = detailData?.episodes[episodeIndex] || '';
  if (newUrl !== currentVideoUrl) {
    setVideoUrl(newUrl);
  }
}

function getEpisodeGroupsSignature(detail: SearchResult): string {
  return (detail.episode_groups || [])
    .map((group) => `${group.label}:${group.count}`)
    .join('|');
}

function hasDetailContentChange(
  prev: SearchResult,
  next: SearchResult,
): boolean {
  return (
    next.episodes.length !== prev.episodes.length ||
    getEpisodeGroupsSignature(next) !== getEpisodeGroupsSignature(prev) ||
    (!!next.title && next.title !== prev.title)
  );
}

function mergeSourceResult(
  preferred: SearchResult,
  fallback?: SearchResult,
): SearchResult {
  return {
    ...fallback,
    ...preferred,
    title: preferred.title || fallback?.title || '',
    poster: preferred.poster || fallback?.poster || '',
    episodes:
      preferred.episodes && preferred.episodes.length > 0
        ? preferred.episodes
        : fallback?.episodes || [],
    episodes_titles:
      preferred.episodes_titles && preferred.episodes_titles.length > 0
        ? preferred.episodes_titles
        : fallback?.episodes_titles || [],
    source_name: preferred.source_name || fallback?.source_name || '',
    year:
      preferred.year && preferred.year !== 'unknown'
        ? preferred.year
        : fallback?.year || preferred.year,
    class: preferred.class || fallback?.class,
    desc: preferred.desc || fallback?.desc,
    type_name: preferred.type_name || fallback?.type_name,
    douban_id: preferred.douban_id || fallback?.douban_id,
  };
}

// ---------------------------------------------------------------------------
// usePlayInit 入口初始化 hook
// ---------------------------------------------------------------------------

interface UsePlayInitParams {
  currentSource: string;
  currentId: string;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  // 页面最近一次真实起播的源，后台测速据此跳过正在播放的当前源
  playbackStartedSourceRef: MutableRefObject<Pick<
    SearchResult,
    'source' | 'id'
  > | null>;
  videoTitle: string;
  searchTitle: string;
  searchType: string;
  needPreferRef: MutableRefObject<boolean>;
  videoTitleRef: MutableRefObject<string>;
  videoYearRef: MutableRefObject<string>;
  currentEpisodeIndex: number;
  optimizationEnabled: boolean;
  historyRestoreGateRef: MutableRefObject<HistoryRestoreGate>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingStage: Dispatch<
    SetStateAction<'searching' | 'preferring' | 'fetching' | 'ready'>
  >;
  setLoadingMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setDetail: Dispatch<SetStateAction<SearchResult | null>>;
  setCurrentSource: Dispatch<SetStateAction<string>>;
  setCurrentId: Dispatch<SetStateAction<string>>;
  setVideoTitle: Dispatch<SetStateAction<string>>;
  setVideoYear: Dispatch<SetStateAction<string>>;
  setVideoCover: Dispatch<SetStateAction<string>>;
  setVideoDoubanId: Dispatch<SetStateAction<number>>;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  setNeedPrefer: Dispatch<SetStateAction<boolean>>;
  setAvailableSources: Dispatch<SetStateAction<SearchResult[]>>;
  setSourceSearchLoading: Dispatch<SetStateAction<boolean>>;
  setSourceSearchError: Dispatch<SetStateAction<string | null>>;
  setPrecomputedVideoInfo: Dispatch<
    SetStateAction<Map<string, VideoQualityInfo>>
  >;
  setSourceRecommendation: Dispatch<
    SetStateAction<SourceRecommendation | null>
  >;
}

interface QuickSearchResponse {
  detail?: SearchResult | null;
  sources?: SearchResult[];
}

export function usePlayInit({
  currentSource,
  currentId,
  currentSourceRef,
  currentIdRef,
  playbackStartedSourceRef,
  videoTitle,
  searchTitle,
  searchType,
  needPreferRef,
  videoTitleRef,
  videoYearRef,
  currentEpisodeIndex,
  optimizationEnabled,
  historyRestoreGateRef,
  setLoading,
  setLoadingStage,
  setLoadingMessage,
  setError,
  setDetail,
  setCurrentSource,
  setCurrentId,
  setVideoTitle,
  setVideoYear,
  setVideoCover,
  setVideoDoubanId,
  setCurrentEpisodeIndex,
  setNeedPrefer,
  setAvailableSources,
  setSourceSearchLoading,
  setSourceSearchError,
  setPrecomputedVideoInfo,
  setSourceRecommendation,
}: UsePlayInitParams) {
  const initialParamsRef = useRef({
    currentEpisodeIndex,
    currentId,
    currentIdRef,
    currentSource,
    currentSourceRef,
    historyRestoreGateRef,
    needPreferRef,
    optimizationEnabled,
    playbackStartedSourceRef,
    searchTitle,
    searchType,
    setAvailableSources,
    setCurrentEpisodeIndex,
    setCurrentId,
    setCurrentSource,
    setDetail,
    setError,
    setLoading,
    setLoadingMessage,
    setLoadingStage,
    setNeedPrefer,
    setPrecomputedVideoInfo,
    setSourceRecommendation,
    setSourceSearchError,
    setSourceSearchLoading,
    setVideoCover,
    setVideoDoubanId,
    setVideoTitle,
    setVideoYear,
    videoTitle,
    videoTitleRef,
    videoYearRef,
  });

  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;
    const handlePlayerExit = () => abortController.abort();
    window.addEventListener(PLAYER_EXIT_EVENT, handlePlayerExit);
    const {
      currentEpisodeIndex,
      currentId,
      currentIdRef,
      currentSource,
      currentSourceRef,
      historyRestoreGateRef,
      needPreferRef,
      optimizationEnabled,
      playbackStartedSourceRef,
      searchTitle,
      searchType,
      setAvailableSources,
      setCurrentEpisodeIndex,
      setCurrentId,
      setCurrentSource,
      setDetail,
      setError,
      setLoading,
      setLoadingMessage,
      setLoadingStage,
      setNeedPrefer,
      setPrecomputedVideoInfo,
      setSourceRecommendation,
      setSourceSearchError,
      setSourceSearchLoading,
      setVideoCover,
      setVideoDoubanId,
      setVideoTitle,
      setVideoYear,
      videoTitle,
      videoTitleRef,
      videoYearRef,
    } = initialParamsRef.current;

    const fetchDetailData = async (
      source: string,
      id: string,
    ): Promise<SearchResult> => {
      const detailResponse = await fetch(
        `/api/detail?source=${source}&id=${id}`,
        IS_DEVELOPMENT ? { signal, cache: 'no-store' } : { signal },
      );
      if (!detailResponse.ok) {
        throw new Error('获取视频详情失败');
      }
      const detailData = (await detailResponse.json()) as SearchResult;
      setCachedDetail(source, id, detailData);
      saveDetailSnapshot(source, id, detailData);
      return detailData;
    };

    // 后台刷新详情
    const revalidateDetailSnapshot = (
      source: string,
      id: string,
      snapshot: SearchResult,
    ) => {
      void fetchDetailData(source, id)
        .then((fresh) => {
          if (signal.aborted) return;
          if (!fresh.episodes || fresh.episodes.length === 0) return;
          if (!hasDetailContentChange(snapshot, fresh)) return;
          // 历史恢复可能已按快照的分组结构定下集索引，换成新详情时须同步换算，否则分组源会退到上一集
          if (
            currentSourceRef.current === source &&
            currentIdRef.current === id
          ) {
            setCurrentEpisodeIndex((index) =>
              remapEpisodeIndexToDetail(snapshot, fresh, index),
            );
          }
          setDetail((prev) =>
            prev && prev.source === source && prev.id === id
              ? mergeSourceResult(fresh, prev)
              : prev,
          );
          setAvailableSources((prev) => mergeSourceBundle(prev, fresh));
        })
        .catch(() => undefined);
    };

    const fetchSourceDetail = async (
      source: string,
      id: string,
    ): Promise<SearchResult | null> => {
      try {
        const cached = getCachedDetail(source, id);
        if (cached) {
          if (!signal.aborted) setSourceSearchLoading(false);
          return cached;
        }
        const snapshot = readDetailSnapshot(source, id);
        if (snapshot) {
          if (!signal.aborted) setSourceSearchLoading(false);
          revalidateDetailSnapshot(source, id, snapshot);
          return snapshot;
        }
        return await fetchDetailData(source, id);
      } catch (err) {
        if (signal.aborted) return null;
        console.error('获取视频详情失败:', err);
        return null;
      } finally {
        if (!signal.aborted) setSourceSearchLoading(false);
      }
    };

    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal },
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        const results = filterSourcesForPlayback(data.results, {
          title: videoTitleRef.current,
          year: videoYearRef.current,
          searchType:
            searchType === 'tv' || searchType === 'movie' ? searchType : '',
        });
        setAvailableSources((prev) => {
          const detailed = prev.filter(
            (item) => item.episodes && item.episodes.length > 0,
          );
          const sourceOrder = new Map(
            results.map((item, index) => [item.source, index]),
          );
          return detailed
            .reduce((acc, item) => mergeSourceBundle(acc, item), results)
            .sort(
              (a, b) =>
                (sourceOrder.get(a.source) ?? Number.MAX_SAFE_INTEGER) -
                (sourceOrder.get(b.source) ?? Number.MAX_SAFE_INTEGER),
            );
        });
        return results;
      } catch (err) {
        if (signal.aborted) return [];
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        return [];
      } finally {
        if (!signal.aborted) setSourceSearchLoading(false);
      }
    };

    const fetchQuickPlayableData = async (
      query: string,
    ): Promise<QuickSearchResponse | null> => {
      const params = new URLSearchParams({ q: query.trim() });
      if (videoYearRef.current) {
        params.set('year', videoYearRef.current);
      }
      if (searchType === 'tv' || searchType === 'movie') {
        params.set('stype', searchType);
      }

      try {
        const response = await fetch(`/api/search/quick?${params.toString()}`, {
          signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as QuickSearchResponse;
      } catch {
        return null;
      }
    };

    let aggregateGroupRawToClear = '';
    // 除了带播放意图的直达入口（意图已定下集和时间，不读记录），都与搜索、详情并行读取播放记录：到达后供测速预判续播的集，起播时交给历史恢复复用这次请求
    let startupPlayRecordsRequest: Promise<Record<string, PlayRecord>> | null =
      null;
    let startupPlayRecords: Record<string, PlayRecord> | null = null;

    const clearAggregateGroup = () => {
      const rawToClear = aggregateGroupRawToClear;
      if (!rawToClear) return;
      aggregateGroupRawToClear = '';
      window.setTimeout(() => {
        try {
          if (sessionStorage.getItem('aggregate_group') === rawToClear) {
            sessionStorage.removeItem('aggregate_group');
          }
        } catch {
          return;
        }
      }, 10000);
    };

    const clearInvalidAggregateGroup = (raw: string) => {
      try {
        if (sessionStorage.getItem('aggregate_group') === raw) {
          sessionStorage.removeItem('aggregate_group');
        }
      } catch {
        return;
      }
    };

    const loadAggregateGroup = (): SearchResult[] | null => {
      try {
        const raw = sessionStorage.getItem('aggregate_group');
        if (raw) {
          const parsed = JSON.parse(raw) as SearchResult[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            const playableGroup = filterSourcesForPlayback(parsed, {
              title: videoTitleRef.current,
              year: videoYearRef.current,
              searchType:
                searchType === 'tv' || searchType === 'movie' ? searchType : '',
            });
            if (playableGroup.length === 0) {
              clearInvalidAggregateGroup(raw);
              return null;
            }
            aggregateGroupRawToClear = raw;
            return parsed;
          }
        }
      } catch {
        return null;
      }
      return null;
    };

    const finalizePlaybackDetail = async (detailData: SearchResult) => {
      if (signal.aborted || window.location.pathname !== '/play') {
        return;
      }

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      const resolvedYear =
        detailData.year && detailData.year !== 'unknown'
          ? detailData.year
          : videoYearRef.current || detailData.year;
      setVideoYear(resolvedYear);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      if (signal.aborted || !replacePlayPageUrl(detailData, resolvedYear)) {
        return;
      }
      clearAggregateGroup();

      setLoadingStage('ready');
      setLoadingMessage('准备就绪，即将开始播放...');
      // 播放器在放行后才创建：历史恢复还没定下续播的集和时间就放行，会先按当前集起播再被换集
      if (detailData.episodes.length > 0) {
        const historyRestoreGate = historyRestoreGateRef.current;
        historyRestoreGate.playRecords = startupPlayRecordsRequest;
        await waitForHistoryRestore(
          historyRestoreGate,
          detailData,
          HISTORY_RESTORE_WAIT_TIMEOUT_MS,
          signal,
        );
        historyRestoreGate.playRecords = null;
        if (signal.aborted) return;
      }
      setLoading(false);
    };

    const getActiveSourceKey = () => {
      const source = currentSourceRef.current;
      const id = currentIdRef.current;
      return source && id ? getSourceKey({ source, id }) : '';
    };

    // 起播登记的源必须仍是当前源：页面换源后登记的是旧源，新的当前源还没起播
    const getPlayingSourceKey = () => {
      const started = playbackStartedSourceRef.current;
      const activeKey = getActiveSourceKey();
      return started && getSourceKey(started) === activeKey ? activeKey : '';
    };

    const initAll = async () => {
      if (signal.aborted) return;
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '正在获取视频详情...'
          : '正在搜索播放源...',
      );

      if (
        !currentSource ||
        !currentId ||
        needPreferRef.current ||
        !hasMatchingPlayIntent({ source: currentSource, id: currentId })
      ) {
        startupPlayRecordsRequest = getAllPlayRecords();
        void startupPlayRecordsRequest.then(
          (records) => {
            startupPlayRecords = records;
          },
          () => undefined,
        );
      }

      const cachedGroup = loadAggregateGroup();

      if (currentSource && currentId && !needPreferRef.current) {
        const fastDetail = await fetchSourceDetail(currentSource, currentId);
        if (signal.aborted) return;
        if (fastDetail?.episodes && fastDetail.episodes.length > 0) {
          setAvailableSources(mergeSourceBundle([], fastDetail));
          void fetchSourcesData(searchTitle || videoTitle);
          await finalizePlaybackDetail(fastDetail);
          return;
        }
      }

      // quick 竞速在服务端已优先直连源，这里不等待选源上下文
      const selectionContextPromise = getSourceSelectionContext();
      const quickQuery = searchTitle || videoTitle;
      if (!cachedGroup && !currentSource && !currentId && optimizationEnabled) {
        const quickData = quickQuery
          ? await fetchQuickPlayableData(quickQuery)
          : null;
        if (signal.aborted) return;

        const quickDetail = quickData?.detail;
        if (quickDetail?.episodes && quickDetail.episodes.length > 0) {
          const quickSources = quickData?.sources || [quickDetail];
          saveDetailSnapshot(quickDetail.source, quickDetail.id, quickDetail);
          setAvailableSources(
            quickSources.reduce(
              (acc, item) => mergeSourceBundle(acc, item),
              [] as SearchResult[],
            ),
          );
          setSourceSearchLoading(true);
          void fetchSourcesData(quickQuery);
          await finalizePlaybackDetail(quickDetail);
          return;
        }
      }

      let sourcesInfo: SearchResult[];
      if (cachedGroup) {
        sourcesInfo = filterSourcesForPlayback(cachedGroup, {
          title: videoTitleRef.current,
          year: videoYearRef.current,
          searchType:
            searchType === 'tv' || searchType === 'movie' ? searchType : '',
        });
        setAvailableSources(sourcesInfo);
        setSourceSearchLoading(false);
      } else {
        sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      }
      if (signal.aborted) return;
      if (currentSource && currentId) {
        const detailedSource = await fetchSourceDetail(
          currentSource,
          currentId,
        );
        if (detailedSource) {
          const matchedSource = sourcesInfo.find(
            (source) =>
              source.source === currentSource && source.id === currentId,
          );
          const mergedCurrentSource = mergeSourceResult(
            detailedSource,
            matchedSource,
          );
          sourcesInfo = mergeSourceBundle(sourcesInfo, mergedCurrentSource);
        }
        setAvailableSources(sourcesInfo);
      }
      if (signal.aborted) return;
      if (sourcesInfo.length === 0) {
        clearAggregateGroup();
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      const selectionContext = await selectionContextPromise;
      if (signal.aborted) return;
      let detailData: SearchResult = preferDirectRouteSources(
        sourcesInfo,
        selectionContext,
        readSourcePlaybackStats(),
      )[0];
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) =>
            source.source === currentSource && source.id === currentId,
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      const shouldPreferSource =
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled &&
        sourcesInfo.length > 1;

      if (shouldPreferSource) {
        setLoadingStage('preferring');
        setLoadingMessage('正在优选最佳播放源...');

        // 续播的集按已到的播放记录预判，未到时退回本地缓存，不为测速等待记录请求
        const cachedPlayRecords = getCachedPlayRecordsSnapshot();
        detailData = await preferBestSource(
          sourcesInfo,
          (source) =>
            peekHistoryRestoreEpisodeIndex(
              source,
              startupPlayRecords ?? cachedPlayRecords,
            ) ?? currentEpisodeIndex,
          getActiveSourceKey,
          getPlayingSourceKey,
          setPrecomputedVideoInfo,
          setSourceRecommendation,
          selectionContext,
          signal,
        );
      }
      if (signal.aborted) return;

      if (!detailData.episodes || detailData.episodes.length === 0) {
        setLoadingStage('fetching');
        setLoadingMessage('正在获取视频详情...');
        const fullDetail = await fetchSourceDetail(
          detailData.source,
          detailData.id,
        );
        if (fullDetail) {
          detailData = mergeSourceResult(fullDetail, detailData);
          sourcesInfo = mergeSourceBundle(sourcesInfo, detailData);
          setAvailableSources(sourcesInfo);
        }
      }

      if (signal.aborted) return;
      await finalizePlaybackDetail(detailData);
    };

    initAll();

    return () => {
      window.removeEventListener(PLAYER_EXIT_EVENT, handlePlayerExit);
      abortController.abort();
    };
  }, []);
}
