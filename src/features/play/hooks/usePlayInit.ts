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
  readDetailSnapshot,
  saveDetailSnapshot,
} from '@/features/play/lib/detailSnapshot';
import { calculateSourceScore } from '@/features/play/lib/playUtils';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { isVodM3u8Url } from '@/features/play/lib/vodProxyUrl';
import { PLAYER_EXIT_EVENT } from '@/lib/navigation-return';
import { prefetchM3U8 } from '@/lib/player-runtime';
import { getProxyModes, shouldUseServerProxy } from '@/lib/proxy-modes';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { filterSourcesForPlayback } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';

const DETAIL_CACHE_TTL_MS = 3 * 60 * 1000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const SOURCE_PROBE_FOREGROUND_LIMIT = 4;
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

function getSourceKey(source: SearchResult) {
  return `${source.source}-${source.id}`;
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
  setPrecomputedVideoInfo: Dispatch<
    SetStateAction<Map<string, VideoQualityInfo>>
  >,
  setSourceRecommendation: Dispatch<
    SetStateAction<SourceRecommendation | null>
  >,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (sources.length === 1) return sources[0];

  setSourceRecommendation(null);
  const proxyModes = await getProxyModes();
  if (signal?.aborted) return sources[0];

  const collectedResults: SourceProbeResult[] = [];
  let selectedResult: SourceProbeResult | null = null;
  let recommendedKey = '';

  const writeProbeInfo = (source: SearchResult, info: VideoQualityInfo) => {
    const key = getSourceKey(source);
    setPrecomputedVideoInfo((prev) => {
      const next = new Map(prev);
      next.set(key, info);
      return next;
    });
  };

  const notifyBetterSource = () => {
    if (!selectedResult || collectedResults.length < 2) return;
    const selectedKey = getSourceKey(selectedResult.source);
    const scored = scoreProbeResults(collectedResults);
    const best = scored[0];
    const selected = scored.find(
      (item) => getSourceKey(item.source) === selectedKey,
    );
    if (!best || !selected) return;
    const bestKey = getSourceKey(best.source);
    if (bestKey === selectedKey) return;
    if (bestKey === recommendedKey) return;
    if (best.score <= selected.score) return;

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
    const episodeUrl = source.episodes?.[0];
    if (!episodeUrl) {
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
      if (signal?.aborted) return null;
      const result = { source, testResult };
      collectedResults.push(result);
      writeProbeInfo(source, testResult);
      notifyBetterSource();
      return result;
    } catch {
      if (!signal?.aborted) {
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
              selectedResult = result;
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

  for (
    let start = 0;
    start < sources.length && !signal?.aborted;
    start += SOURCE_PROBE_FOREGROUND_LIMIT
  ) {
    const batch = sources.slice(start, start + SOURCE_PROBE_FOREGROUND_LIMIT);
    const result = await probeBatchUntilSuccess(batch);
    if (result) {
      const remaining = sources.slice(start + SOURCE_PROBE_FOREGROUND_LIMIT);
      void probeRemainingSources(remaining);
      const runnerUpEpisode = batch.find(
        (source) => getSourceKey(source) !== getSourceKey(result.source),
      )?.episodes?.[0];
      if (runnerUpEpisode && isVodM3u8Url(runnerUpEpisode)) {
        prefetchM3U8(
          `/api/proxy/m3u8?url=${encodeURIComponent(runnerUpEpisode)}`,
        );
      }
      return result.source;
    }
  }

  return sources[0];
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

function hasDetailContentChange(
  prev: SearchResult,
  next: SearchResult,
): boolean {
  return (
    next.episodes.length !== prev.episodes.length ||
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
  videoTitle: string;
  searchTitle: string;
  searchType: string;
  needPreferRef: MutableRefObject<boolean>;
  videoTitleRef: MutableRefObject<string>;
  videoYearRef: MutableRefObject<string>;
  currentEpisodeIndex: number;
  optimizationEnabled: boolean;
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
  videoTitle,
  searchTitle,
  searchType,
  needPreferRef,
  videoTitleRef,
  videoYearRef,
  currentEpisodeIndex,
  optimizationEnabled,
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
    currentSource,
    needPreferRef,
    optimizationEnabled,
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
      currentSource,
      needPreferRef,
      optimizationEnabled,
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
          return detailed.reduce(
            (acc, item) => mergeSourceBundle(acc, item),
            results,
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

    const finalizePlaybackDetail = async (
      detailData: SearchResult,
      options?: { skipTransitionDelay?: boolean },
    ) => {
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

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', resolvedYear);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      newUrl.searchParams.delete('singleSource');
      newUrl.searchParams.delete('directStart');
      if (signal.aborted || window.location.pathname !== '/play') {
        return;
      }
      window.history.replaceState(window.history.state, '', newUrl.toString());
      clearAggregateGroup();

      setLoadingStage('ready');
      setLoadingMessage('准备就绪，即将开始播放...');
      if (!options?.skipTransitionDelay) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (signal.aborted) {
        return;
      }
      setLoading(false);
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

      const cachedGroup = loadAggregateGroup();

      if (currentSource && currentId && !needPreferRef.current) {
        const fastDetail = await fetchSourceDetail(currentSource, currentId);
        if (signal.aborted) return;
        if (fastDetail?.episodes && fastDetail.episodes.length > 0) {
          setAvailableSources(mergeSourceBundle([], fastDetail));
          void fetchSourcesData(searchTitle || videoTitle);
          await finalizePlaybackDetail(fastDetail, {
            skipTransitionDelay: true,
          });
          return;
        }
      }

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
          await finalizePlaybackDetail(quickDetail, {
            skipTransitionDelay: true,
          });
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

      let detailData: SearchResult = sourcesInfo[0];
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

        detailData = await preferBestSource(
          sourcesInfo,
          setPrecomputedVideoInfo,
          setSourceRecommendation,
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
