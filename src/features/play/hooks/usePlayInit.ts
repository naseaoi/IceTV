import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useRef,
} from 'react';

import {
  readDetailSnapshot,
  saveDetailSnapshot,
} from '@/features/play/lib/detailSnapshot';
import { calculateSourceScore } from '@/features/play/lib/playUtils';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { isVodM3u8Url } from '@/features/play/lib/vodProxyUrl';
import { prefetchM3U8 } from '@/lib/player-runtime';
import { getProxyModes, shouldUseServerProxy } from '@/lib/proxy-modes';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { filterSourcesForPlayback } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';

const DETAIL_CACHE_TTL_MS = 3 * 60 * 1000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
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

/** 高速源缩短等待，低速源保持完整窗口 */
function resolveHarvestWindow(testResult: { loadSpeed: string }): number {
  const match = testResult.loadSpeed.match(/^([\d.]+)\s*(Mbps|KB\/s|MB\/s)$/);
  if (!match) return 1500;
  const value = parseFloat(match[1]);
  const unit = match[2];
  let speedKBps: number;
  if (unit === 'Mbps') speedKBps = (value * 1024) / 8;
  else speedKBps = unit === 'MB/s' ? value * 1024 : value;
  if (speedKBps >= 2048) return 500;
  if (speedKBps >= 1024) return 800;
  return 1500;
}

async function preferBestSource(
  sources: SearchResult[],
  setPrecomputedVideoInfo: Dispatch<
    SetStateAction<
      Map<string, { quality: string; loadSpeed: string; pingTime: number }>
    >
  >,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (sources.length === 1) return sources[0];

  // 预先获取流量路由配置（在 Promise 构造器外 await）
  const proxyModes = await getProxyModes();
  if (signal?.aborted) return sources[0];

  type TestResult = {
    source: SearchResult;
    testResult: { quality: string; loadSpeed: string; pingTime: number };
  };

  const collectedResults: TestResult[] = [];
  let harvestTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  return new Promise<SearchResult>((resolveMain) => {
    if (signal?.aborted) {
      resolveMain(sources[0]);
      return;
    }
    const onAbort = () => {
      if (!settled) {
        settled = true;
        if (harvestTimer) clearTimeout(harvestTimer);
        resolveMain(sources[0]);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const finalize = () => {
      if (settled) return;
      settled = true;
      if (harvestTimer) clearTimeout(harvestTimer);

      const newVideoInfoMap = new Map<
        string,
        {
          quality: string;
          loadSpeed: string;
          pingTime: number;
          hasError?: boolean;
        }
      >();
      const collectedKeys = new Set<string>();
      for (const r of collectedResults) {
        const key = `${r.source.source}-${r.source.id}`;
        newVideoInfoMap.set(key, r.testResult);
        collectedKeys.add(key);
      }
      for (const s of sources) {
        const key = `${s.source}-${s.id}`;
        if (!collectedKeys.has(key)) {
          newVideoInfoMap.set(key, {
            quality: '未知',
            loadSpeed: '未知',
            pingTime: 0,
            hasError: true,
          });
        }
      }
      setPrecomputedVideoInfo(newVideoInfoMap);

      if (collectedResults.length === 0) {
        resolveMain(sources[0]);
        return;
      }

      const validSpeeds = collectedResults
        .map((r) => {
          const m = r.testResult.loadSpeed.match(
            /^([\d.]+)\s*(Mbps|KB\/s|MB\/s)$/,
          );
          if (!m) return 0;
          const v = parseFloat(m[1]);
          const u = m[2];
          if (u === 'Mbps') return (v * 1024) / 8;
          return u === 'MB/s' ? v * 1024 : v;
        })
        .filter((s) => s > 0);
      const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;
      const validPings = collectedResults
        .map((r) => r.testResult.pingTime)
        .filter((p) => p > 0);
      const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
      const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

      const scored = collectedResults.map((r) => ({
        ...r,
        score: calculateSourceScore(r.testResult, maxSpeed, minPing, maxPing),
      }));
      scored.sort((a, b) => b.score - a.score);

      const runnerUpEpisode = scored[1]?.source.episodes?.[0];
      if (runnerUpEpisode && isVodM3u8Url(runnerUpEpisode)) {
        prefetchM3U8(
          `/api/proxy/m3u8?url=${encodeURIComponent(runnerUpEpisode)}`,
        );
      }

      resolveMain(scored[0].source);
    };

    let pendingCount = sources.length;
    for (const source of sources) {
      if (!source.episodes || source.episodes.length === 0) {
        pendingCount--;
        if (pendingCount === 0) finalize();
        continue;
      }
      const episodeUrl = source.episodes[0];
      const useProxy = shouldUseServerProxy(
        source.source,
        episodeUrl,
        proxyModes,
      );
      probeVodEpisodeUrl(episodeUrl, useProxy, source.source)
        .then((testResult) => {
          if (settled) return;
          collectedResults.push({ source, testResult });
          if (!harvestTimer) {
            const windowMs = resolveHarvestWindow(testResult);
            harvestTimer = setTimeout(finalize, windowMs);
          }
        })
        .catch(() => {})
        .finally(() => {
          pendingCount--;
          if (pendingCount === 0 && !settled) finalize();
        });
    }
  });
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
// usePlayInit — 入口初始化 hook
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
    SetStateAction<
      Map<string, { quality: string; loadSpeed: string; pingTime: number }>
    >
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

    const loadAggregateGroup = (): SearchResult[] | null => {
      try {
        const raw = sessionStorage.getItem('aggregate_group');
        if (raw) {
          sessionStorage.removeItem('aggregate_group');
          const parsed = JSON.parse(raw) as SearchResult[];
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('准备就绪，即将开始播放...');
      if (!options?.skipTransitionDelay) {
        await new Promise((r) => setTimeout(r, 200));
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

      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('正在优选最佳播放源...');

        detailData = await preferBestSource(
          sourcesInfo,
          setPrecomputedVideoInfo,
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
      abortController.abort();
    };
  }, []);
}
