'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import {
  cachePlaybackHistorySnapshot,
  deletePlaybackHistoryItem,
  getCachedPlaybackHistorySnapshot,
  getPlaybackHistory,
} from '@/features/playback-stats/lib/client';
import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
  getPlaybackSessionMergeKey,
} from '@/features/playback-stats/lib/history';
import type { PlaybackHistoryResponse } from '@/features/playback-stats/types';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
import { showToast } from '@/lib/toast';
import type { PlaybackSession } from '@/lib/types';
import { canUseNetworkPrefetch, warmupForPlayback } from '@/lib/video-prefetch';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// 只读已有快照；路由 loading 与客户端占位共用，不为占位发起请求。
export function usePlaybackHistoryPlaceholder() {
  const runtimeConfig = useRuntimeConfig();
  const [snapshot, setSnapshot] = useState<PlaybackHistoryResponse | null>(
    null,
  );
  useIsomorphicLayoutEffect(() => {
    setSnapshot(getCachedPlaybackHistorySnapshot());
  }, []);
  return {
    snapshot,
    count: Math.max(
      1,
      Math.floor(runtimeConfig.PLAYBACK_HISTORY_PAGE_SIZE || 10),
    ),
  };
}

export function usePlaybackHistory() {
  const runtimeConfig = useRuntimeConfig();
  const historyPageSize = Math.max(
    1,
    Math.floor(runtimeConfig.PLAYBACK_HISTORY_PAGE_SIZE || 10),
  );
  const historyLimit = Math.max(
    historyPageSize,
    Math.floor(runtimeConfig.PLAYBACK_HISTORY_LIMIT || 500),
  );
  const [items, setItems] = useState<PlaybackSession[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
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
  const skeletonCount = Math.min(historyPageSize, historyLimit);

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

    const loadInitial = async () => {
      try {
        const hasKeyword = searchKeyword.length > 0;
        const shouldShowSkeleton =
          !hasKeyword && !getCachedPlaybackHistorySnapshot();
        if (shouldShowSkeleton) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        const snapshotBeforeFetch = hasKeyword
          ? null
          : getCachedPlaybackHistorySnapshot();
        const response = await getPlaybackHistory(
          undefined,
          hasKeyword ? searchKeyword : undefined,
          Math.min(historyPageSize, historyLimit),
        );
        if (!cancelled) {
          if (hasKeyword) {
            setItems(
              dedupePlaybackSessionsByTitle(
                filterPlaybackHistorySessions(response.items),
                {
                  mergeWatchSeconds: true,
                },
              ),
            );
            setNextCursor(response.nextCursor);
            return;
          }

          const responseIds = new Set(response.items.map((item) => item.id));
          const responseKeys = new Set(
            dedupePlaybackSessionsByTitle(
              filterPlaybackHistorySessions(response.items),
              {
                mergeWatchSeconds: true,
              },
            ).map(getPlaybackSessionMergeKey),
          );
          const cachedTail =
            snapshotBeforeFetch &&
            snapshotBeforeFetch.items.length > response.items.length
              ? snapshotBeforeFetch.items.filter(
                  (item) =>
                    !responseIds.has(item.id) &&
                    !responseKeys.has(getPlaybackSessionMergeKey(item)),
                )
              : [];
          const nextItems = dedupePlaybackSessionsByTitle(
            filterPlaybackHistorySessions([...response.items, ...cachedTail]),
            {
              mergeWatchSeconds: true,
            },
          );
          const nextHistory = {
            items: nextItems,
            nextCursor:
              cachedTail.length > 0
                ? snapshotBeforeFetch?.nextCursor || response.nextCursor
                : response.nextCursor,
          };
          cachePlaybackHistorySnapshot(nextHistory);
          setItems(nextHistory.items);
          setNextCursor(nextHistory.nextCursor);
        }
      } catch (error) {
        console.error('获取播放历史失败:', error);
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
    };
  }, [historyLimit, historyPageSize, searchKeyword]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const remaining = historyLimit - items.length;
    if (remaining <= 0) return;
    setLoadingMore(true);
    try {
      const response: PlaybackHistoryResponse = await getPlaybackHistory(
        nextCursor,
        searchKeyword || undefined,
        Math.min(historyPageSize, remaining),
      );
      setItems((prev) => {
        const nextItems = dedupePlaybackSessionsByTitle(
          filterPlaybackHistorySessions([...prev, ...response.items]),
          {
            limit: historyLimit,
            mergeWatchSeconds: true,
          },
        );
        if (!searchKeyword) {
          cachePlaybackHistorySnapshot({
            items: nextItems,
            nextCursor: response.nextCursor,
          });
        }
        return nextItems;
      });
      setNextCursor(
        items.length + response.items.length >= historyLimit
          ? null
          : response.nextCursor,
      );
    } catch (error) {
      console.error('加载更多播放历史失败:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const removeSessions = useCallback(async (ids: string[]) => {
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
    items,
    loading,
    loadingMore,
    refreshing,
    skeletonCount,
    searchText,
    setSearchText,
    searchKeyword,
    hasMore: Boolean(nextCursor) && items.length < historyLimit,
    loadMore,
    removeSessions,
  };
}

export function usePlayHistorySession() {
  const router = useRouter();

  const prefetchPlayPage = useCallback(() => {
    router.prefetch('/play');
  }, [router]);

  const warmupPlayback = useCallback((item: PlaybackSession) => {
    if (!item.source || !item.video_id) return;
    if (canUseNetworkPrefetch()) {
      warmupForPlayback(item.source, item.video_id);
    }
  }, []);

  const playHistoryItem = useCallback(
    (item: PlaybackSession) => {
      if (!item.source || !item.video_id) return;

      router.prefetch('/play');
      warmupPlayback(item);

      savePlayIntent({
        source: item.source,
        id: item.video_id,
        episodeIndex: Math.max(0, item.episode_index - 1),
        resumeTime: Math.max(0, item.last_position || 0),
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
