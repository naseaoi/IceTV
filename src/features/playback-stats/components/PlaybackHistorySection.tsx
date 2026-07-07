'use client';

import { Clock3, History, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import { PlaybackHistoryItemSkeleton } from '@/features/playback-stats/components/PlaybackHistorySkeleton';
import {
  cachePlaybackHistorySnapshot,
  getCachedPlaybackHistorySnapshot,
  getPlaybackHistory,
} from '@/features/playback-stats/lib/client';
import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
  getPlaybackSessionMergeKey,
} from '@/features/playback-stats/lib/history';
import type { PlaybackHistoryResponse } from '@/features/playback-stats/types';
import { savePlayIntent } from '@/lib/play-intent';
import type { PlaybackSession } from '@/lib/types';
import { canUseNetworkPrefetch, warmupForPlayback } from '@/lib/video-prefetch';

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

function formatWatchedAt(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PlaybackHistorySection() {
  const router = useRouter();
  const runtimeConfig = useRuntimeConfig();
  const historyPageSize = Math.max(
    1,
    Math.floor(runtimeConfig.PLAYBACK_HISTORY_PAGE_SIZE || 10),
  );
  const historyLimit = Math.max(
    historyPageSize,
    Math.floor(runtimeConfig.PLAYBACK_HISTORY_LIMIT || 500),
  );
  const cachedHistory = getCachedPlaybackHistorySnapshot();
  const [items, setItems] = useState<PlaybackSession[]>(() =>
    dedupePlaybackSessionsByTitle(
      filterPlaybackHistorySessions(cachedHistory?.items || []),
      {
        mergeWatchSeconds: true,
      },
    ),
  );
  const [nextCursor, setNextCursor] = useState<number | null>(
    () => cachedHistory?.nextCursor || null,
  );
  const [loading, setLoading] = useState(() => !cachedHistory);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const skeletonCount = Math.min(6, historyPageSize, historyLimit);

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
      router.push(`/play?${params.toString()}`);
    },
    [router, warmupPlayback],
  );

  return (
    <section className='mb-4'>
      <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
          <History className='h-5 w-5 text-orange-500' />
          历史播放
        </h2>
        <div className='relative w-full sm:w-72'>
          <input
            id='playback-history-search'
            name='playbackHistorySearch'
            type='text'
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder='搜索历史播放'
            aria-label='搜索历史播放'
            className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-orange-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 ${
              refreshing ? 'border-orange-300 dark:border-orange-500/70' : ''
            }`}
          />
          {searchText && (
            <button
              type='button'
              title='清空搜索'
              aria-label='清空搜索'
              onClick={() => setSearchText('')}
              className='absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:hover:bg-gray-700 dark:hover:text-gray-200'
            >
              <X className='h-4 w-4' />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className='min-h-[296px] space-y-2'>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <PlaybackHistoryItemSkeleton key={index} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='flex min-h-[296px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400'>
          {searchKeyword ? '未找到匹配的历史播放' : '暂无历史播放'}
        </div>
      ) : (
        <div
          className={`min-h-[296px] space-y-2 transition-opacity ${
            refreshing ? 'opacity-70' : 'opacity-100'
          }`}
        >
          {items.map((item) => (
            <button
              type='button'
              key={item.id}
              className='flex w-full min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white/70 p-3 text-left transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 dark:border-gray-700 dark:bg-gray-900/50 dark:hover:bg-gray-900'
              aria-label={`继续播放 ${item.title}`}
              onClick={() => playHistoryItem(item)}
              onFocus={prefetchPlayPage}
              onMouseEnter={prefetchPlayPage}
            >
              <img
                src={item.cover || '/icons/icon-192x192.png'}
                alt={item.title}
                className='h-14 w-10 shrink-0 rounded object-cover'
              />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                  {item.title}
                </div>
                <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
                  <span>第 {item.episode_index} 集</span>
                  <span>{item.source_name}</span>
                  <span>
                    {formatWatchedAt(item.ended_at || item.started_at)}
                  </span>
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-1 text-sm text-gray-600 dark:text-gray-300'>
                <Clock3 className='h-4 w-4 text-green-500' />
                {formatDuration(item.watch_seconds)}
              </div>
            </button>
          ))}

          {nextCursor && items.length < historyLimit && (
            <div className='pt-2 text-center'>
              <button
                className='rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
