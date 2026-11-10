'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import {
  cachePlaybackHistorySnapshot,
  deletePlaybackHistoryItem,
  getCachedPlaybackHistorySnapshot,
  getPlaybackHistory,
} from '@/features/playback-stats/lib/client';
import type { PlaybackHistoryResponse } from '@/features/playback-stats/types';
import { readListCountCookie } from '@/lib/list-count-cookies';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
import { isGroupedPlayRecordScale } from '@/lib/play-records';
import { showToast } from '@/lib/toast';
import type { WatchHistoryEntry } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import { canUseNetworkPrefetch, warmupForPlayback } from '@/lib/video-prefetch';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// 只读已有快照与计数 cookie，不为占位发起请求；initialCount 是服务端读到的计数，供首屏 HTML 使用。
// count 为首页应显示的条数，已按请求页大小截断。
export function usePlaybackHistoryPlaceholder(initialCount = 0) {
  const runtimeConfig = useRuntimeConfig();
  const pageSize = Math.max(
    1,
    Math.floor(runtimeConfig.PLAYBACK_HISTORY_PAGE_SIZE || 10),
  );
  const [state, setState] = useState<{
    snapshot: PlaybackHistoryResponse | null;
    known: number;
  }>({ snapshot: null, known: initialCount });
  useIsomorphicLayoutEffect(() => {
    const snapshot = getCachedPlaybackHistorySnapshot();
    setState({
      snapshot,
      known: snapshot
        ? snapshot.items.length
        : (readListCountCookie('history_count') ?? initialCount),
    });
  }, [initialCount]);
  return {
    snapshot: state.snapshot,
    count: Math.min(state.known, pageSize),
  };
}

export function usePlaybackHistory() {
  const runtimeConfig = useRuntimeConfig();
  const pageSize = Math.max(
    1,
    Math.floor(runtimeConfig.PLAYBACK_HISTORY_PAGE_SIZE || 10),
  );
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const generation = useRef(0);
  const morePending = useRef(false);
  const failedMore = useRef(false);
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useIsomorphicLayoutEffect(() => {
    const cachedHistory = getCachedPlaybackHistorySnapshot();
    if (!cachedHistory) return;
    setItems(cachedHistory.items);
    setNextCursor(cachedHistory.nextCursor);
    setLoading(false);
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchKeyword(searchText.trim());
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    morePending.current = false;
    failedMore.current = false;
    setLoadingMore(false);
    setError(null);

    const loadInitial = async () => {
      try {
        const hasKeyword = searchKeyword.length > 0;
        const snapshotBeforeFetch = hasKeyword
          ? null
          : getCachedPlaybackHistorySnapshot();
        if (!hasKeyword && !snapshotBeforeFetch) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        const response = await getPlaybackHistory(
          undefined,
          hasKeyword ? searchKeyword : undefined,
          pageSize,
        );
        if (cancelled) return;
        if (hasKeyword) {
          setItems(response.items);
          setNextCursor(response.nextCursor);
          return;
        }

        // 已加载过更多页时保留快照尾部，返回本页时不丢掉已翻到的位置
        const responseIds = new Set(response.items.map((item) => item.id));
        const cachedTail =
          snapshotBeforeFetch &&
          snapshotBeforeFetch.items.length > response.items.length &&
          response.nextCursor
            ? snapshotBeforeFetch.items
                .slice(response.items.length)
                .filter((item) => !responseIds.has(item.id))
            : [];
        const nextHistory = {
          items: [...response.items, ...cachedTail],
          nextCursor:
            cachedTail.length > 0
              ? (snapshotBeforeFetch?.nextCursor ?? null)
              : response.nextCursor,
        };
        cachePlaybackHistorySnapshot(nextHistory);
        setItems(nextHistory.items);
        setNextCursor(nextHistory.nextCursor);
      } catch (error) {
        if (!cancelled && !isAbortError(error))
          setError(getErrorMessage(error, '加载失败'));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [pageSize, searchKeyword, retryCount]);

  const loadMore = async () => {
    if (!nextCursor || morePending.current || refreshing) return;
    morePending.current = true;
    const requestGeneration = generation.current;
    setError(null);
    setLoadingMore(true);
    try {
      const response = await getPlaybackHistory(
        nextCursor,
        searchKeyword || undefined,
        pageSize,
      );
      if (requestGeneration !== generation.current) return;
      setItems((prev) => {
        const loadedIds = new Set(prev.map((item) => item.id));
        const nextItems = [
          ...prev,
          ...response.items.filter((item) => !loadedIds.has(item.id)),
        ];
        if (!searchKeyword) {
          cachePlaybackHistorySnapshot({
            items: nextItems,
            nextCursor: response.nextCursor,
          });
        }
        return nextItems;
      });
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (requestGeneration === generation.current && !isAbortError(error)) {
        failedMore.current = true;
        setError(getErrorMessage(error, '加载失败'));
      }
    } finally {
      if (requestGeneration === generation.current) {
        morePending.current = false;
        setLoadingMore(false);
      }
    }
  };

  const removeEntries = useCallback(async (ids: string[]) => {
    const results = await Promise.allSettled(
      ids.map((id) => deletePlaybackHistoryItem(id)),
    );
    const removed = new Set(
      ids.filter((_, index) => results[index].status === 'fulfilled'),
    );
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('删除播放历史失败:', result.reason);
      }
    });
    if (removed.size > 0) {
      setItems((prev) => prev.filter((item) => !removed.has(item.id)));
    }
    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    if (failed > 0) {
      showToast(
        removed.size > 0
          ? `已删除 ${removed.size} 条，${failed} 条删除失败，请重试`
          : '删除失败，请重试',
        'error',
      );
    }
    return removed.size;
  }, []);

  return {
    error,
    retry: () =>
      failedMore.current
        ? void loadMore()
        : setRetryCount((count) => count + 1),
    items,
    loading,
    loadingMore,
    refreshing,
    pageSize,
    searchText,
    setSearchText,
    searchKeyword,
    hasMore: Boolean(nextCursor),
    loadMore,
    removeEntries,
  };
}

export function usePlayHistorySession() {
  const router = useRouter();

  const prefetchPlayPage = useCallback(() => {
    router.prefetch('/play');
  }, [router]);

  const warmupPlayback = useCallback((item: WatchHistoryEntry) => {
    if (!item.source || !item.video_id) return;
    if (canUseNetworkPrefetch()) {
      warmupForPlayback(item.source, item.video_id);
    }
  }, []);

  const playHistoryItem = useCallback(
    (item: WatchHistoryEntry) => {
      if (!item.source || !item.video_id) return;

      router.prefetch('/play');
      warmupPlayback(item);

      savePlayIntent({
        source: item.source,
        id: item.video_id,
        episodeIndex: Math.max(0, item.episode_index - 1),
        resumeTime: Math.max(0, item.position || 0),
        ...(isGroupedPlayRecordScale(item)
          ? {
              groupLabel: item.group_label,
              groupIndex: item.group_index,
              groupTotal: item.group_total,
            }
          : {}),
      });

      const params = new URLSearchParams({
        source: item.source,
        id: item.video_id,
        title: item.title,
      });
      if (item.year) params.set('year', item.year);
      router.push(
        withReturnTo(`/play?${params.toString()}`, getCurrentNavigationPath()),
      );
    },
    [router, warmupPlayback],
  );

  return { playHistoryItem, prefetchPlayPage };
}
