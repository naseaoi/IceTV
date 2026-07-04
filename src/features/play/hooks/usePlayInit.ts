import { Dispatch, MutableRefObject, SetStateAction, useEffect } from 'react';

import { filterSourcesForPlayback } from '@/lib/source-match';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { SearchResult } from '@/lib/types';
import { prefetchM3U8 } from '@/lib/player-runtime';
import { getProxyModes, shouldUseServerProxy } from '@/lib/proxy-modes';

import { calculateSourceScore } from '@/features/play/lib/playUtils';
import {
  readDetailSnapshot,
  saveDetailSnapshot,
} from '@/features/play/lib/detailSnapshot';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { isVodM3u8Url } from '@/features/play/lib/vodProxyUrl';

// ---------------------------------------------------------------------------
// 客户端 detail 内存缓存 — 短时间退出重进时避免重复请求
// ---------------------------------------------------------------------------

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
  // 防止无限膨胀
  if (detailCache.size > 100) {
    const oldest = detailCache.keys().next().value;
    if (oldest) detailCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// resolveHarvestWindow — 根据首个测速结果自适应调整收割窗口
// ---------------------------------------------------------------------------

/** 高速源缩短等待，低速源保持完整窗口 */
function resolveHarvestWindow(testResult: { loadSpeed: string }): number {
  const match = testResult.loadSpeed.match(/^([\d.]+)\s*(Mbps|KB\/s|MB\/s)$/);
  if (!match) return 1500;
  const value = parseFloat(match[1]);
  const unit = match[2];
  let speedKBps: number;
  if (unit === 'Mbps') speedKBps = (value * 1024) / 8;
  else speedKBps = unit === 'MB/s' ? value * 1024 : value;
  // > 2 MB/s → 500ms，> 1 MB/s → 800ms，否则 1500ms
  if (speedKBps >= 2048) return 500;
  if (speedKBps >= 1024) return 800;
  return 1500;
}

// ---------------------------------------------------------------------------
// preferBestSource — 播放源优选（竞速模式）
// 所有源同时并发测试，首个成功后启动短暂收割窗口，窗口结束后从已收集
// 结果中选最优源。快源不再被慢源拖累，大幅缩短用户等待时间。
// ---------------------------------------------------------------------------

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
    // 外部中止时立即返回首个源
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

    // 最终从已收集结果中选出最优源并返回
    const finalize = () => {
      if (settled) return;
      settled = true;
      if (harvestTimer) clearTimeout(harvestTimer);

      // 构建预计算 Map（SourcesTab 复用）
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
      // 未完成的源标记为 hasError，后续 SourcesTab 会自行重新测速
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

      // 评分排序
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

      // 预热运行 up：把排名第二的源的 m3u8 打进服务端 SWR 缓存，
      // 一旦首选起播失败自动降级时能省掉一次回源 RTT。
      // 忽略带签名 token 的 URL（proxy 缓存已跳过签名 URL，这里预取也没意义）
      const runnerUpEpisode = scored[1]?.source.episodes?.[0];
      if (runnerUpEpisode && isVodM3u8Url(runnerUpEpisode)) {
        prefetchM3U8(
          `/api/proxy/m3u8?url=${encodeURIComponent(runnerUpEpisode)}`,
        );
      }

      resolveMain(scored[0].source);
    };

    // 全量并发测试
    let pendingCount = sources.length;
    for (const source of sources) {
      if (!source.episodes || source.episodes.length === 0) {
        pendingCount--;
        if (pendingCount === 0) finalize();
        continue;
      }
      const useProxy = shouldUseServerProxy(source.source, proxyModes);
      probeVodEpisodeUrl(source.episodes[0], useProxy, source.source)
        .then((testResult) => {
          if (settled) return;
          collectedResults.push({ source, testResult });
          // 首个成功：启动自适应收割窗口
          if (!harvestTimer) {
            const windowMs = resolveHarvestWindow(testResult);
            harvestTimer = setTimeout(finalize, windowMs);
          }
        })
        .catch(() => {
          // 测速失败，不计入
        })
        .finally(() => {
          pendingCount--;
          // 所有源都完成了（无论成败），直接 finalize
          if (pendingCount === 0 && !settled) finalize();
        });
    }
  });
}

// ---------------------------------------------------------------------------
// updateVideoUrl — 更新视频播放地址
// ---------------------------------------------------------------------------

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
  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;

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

    // 快照秒播后后台刷新详情，追更时更新界面
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
        // 保留已通过 detail 补全的条目（搜索可能晚于详情先行路径完成）
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

    // 从 sessionStorage 读取聚合组数据（搜索页传递），读后立即清理
    const loadAggregateGroup = (): SearchResult[] | null => {
      try {
        const raw = sessionStorage.getItem('aggregate_group');
        if (raw) {
          sessionStorage.removeItem('aggregate_group');
          const parsed = JSON.parse(raw) as SearchResult[];
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // 解析失败，静默忽略
      }
      return null;
    };

    const finalizePlaybackDetail = async (detailData: SearchResult) => {
      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      // 防御：detailData.year 为 unknown 时保留 URL 参数中的年份
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

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', resolvedYear);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('准备就绪，即将开始播放...');
      // 保留很短的过渡，避免 loading 文案闪烁。
      await new Promise((r) => setTimeout(r, 200));
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

      // 优先使用搜索页通过 sessionStorage 传递的聚合组数据，避免重新搜索导致源站列表不一致
      const cachedGroup = loadAggregateGroup();

      // 指定源且无需优选时详情先行直接起播，聚合搜索转入后台补齐换源列表
      if (
        !cachedGroup &&
        currentSource &&
        currentId &&
        !needPreferRef.current
      ) {
        const fastDetail = await fetchSourceDetail(currentSource, currentId);
        if (signal.aborted) return;
        if (fastDetail?.episodes && fastDetail.episodes.length > 0) {
          setAvailableSources(mergeSourceBundle([], fastDetail));
          void fetchSourcesData(searchTitle || videoTitle);
          await finalizePlaybackDetail(fastDetail);
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

      // 选定源的 episodes 为空（搜索阶段的残缺数据），补调 detail 获取完整信息
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
