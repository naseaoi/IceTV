'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { EMPTY_FAVORITE_COUNTS } from '@/features/favorites/components/FavoriteLibraryToolbar';
import type {
  FavoriteFilter,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import type { FavoriteLibraryPage } from '@/features/favorites/lib/library-query';
import type { FavoriteItem } from '@/features/favorites/types';
import { clearAllFavorites, subscribeToDataUpdates } from '@/lib/db.client';
import { fetchWithAuth } from '@/lib/db.client.internal';
import { FAVORITE_RENDER_CHUNK } from '@/lib/favorites-count';
import {
  readFavoriteItemsCount,
  writeFavoriteItemsCount,
} from '@/lib/local-preferences';
import { parseStorageKey } from '@/lib/utils';
import { VIDEO_REVIEWS_UPDATED_EVENT } from '@/lib/video-reviews';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useFavoriteLibrary(
  initialSkeletonCount = 0,
  options: { query: string; filter: FavoriteFilter; sort: FavoriteSort } = {
    query: '',
    filter: 'all',
    sort: 'saved',
  },
) {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  const [query, setQuery] = useState(options.query);
  const [version, setVersion] = useState(0);
  const [page, setPage] = useState<FavoriteLibraryPage | null>(null);
  const [pending, setPending] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skeletonCount, setSkeletonCount] = useState(
    Math.min(Math.max(0, initialSkeletonCount), FAVORITE_RENDER_CHUNK),
  );
  const request = useRef<{
    controller: AbortController;
    generation: number;
  } | null>(null);
  const generation = useRef(0);
  // 各筛选条件的首页快照：切回已看过的条件时先展示快照再后台刷新
  const firstPages = useRef(new Map<string, FavoriteLibraryPage>());
  const queryPending = query !== options.query;
  const refresh = useCallback(() => {
    firstPages.current.clear();
    setVersion((value) => value + 1);
  }, []);

  useIsomorphicLayoutEffect(() => {
    setSkeletonCount((current) =>
      Math.min(
        Math.max(current, readFavoriteItemsCount()),
        FAVORITE_RENDER_CHUNK,
      ),
    );
  }, []);

  useEffect(() => {
    // 输入立即取消旧请求，防抖结束再发新请求。
    request.current?.controller.abort();
    generation.current += 1;
    const timer = setTimeout(() => setQuery(options.query), 250);
    return () => clearTimeout(timer);
  }, [options.query]);

  useEffect(() => {
    firstPages.current.clear();
    setPage(null);
  }, [profileId]);

  useEffect(() => {
    const unsubFavorites = subscribeToDataUpdates('favoritesUpdated', refresh);
    const unsubRecords = subscribeToDataUpdates('playRecordsUpdated', refresh);
    window.addEventListener('userLibraryUpdated', refresh);
    window.addEventListener(VIDEO_REVIEWS_UPDATED_EVENT, refresh);
    return () => {
      unsubFavorites();
      unsubRecords();
      window.removeEventListener('userLibraryUpdated', refresh);
      window.removeEventListener(VIDEO_REVIEWS_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  const fetchPage = useCallback(
    async (cursor?: string | null) => {
      request.current?.controller.abort();
      const controller = new AbortController();
      const currentGeneration = ++generation.current;
      request.current = { controller, generation: currentGeneration };
      const params = new URLSearchParams({
        format: 'library',
        q: query,
        filter: options.filter,
        sort: options.sort,
      });
      const pageKey = params.toString();
      if (cursor) setLoadingMore(true);
      else {
        // 保留当前页直到新结果到达，避免切换筛选时整页闪回骨架
        setPending(true);
        const snapshot = firstPages.current.get(pageKey);
        if (snapshot) setPage(snapshot);
      }
      setError(null);
      try {
        if (cursor) params.set('cursor', cursor);
        const response = await fetchWithAuth(`/api/favorites?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('收藏加载失败，请重试');
        const result: FavoriteLibraryPage = await response.json();
        if (
          generation.current !== currentGeneration ||
          controller.signal.aborted
        )
          return;
        if (!cursor) firstPages.current.set(pageKey, result);
        setPage((previous) => {
          if (!cursor || !previous) return result;
          const seen = new Set(previous.items.map((item) => item.key));
          return {
            ...result,
            items: [
              ...previous.items,
              ...result.items.filter((item) => !seen.has(item.key)),
            ],
          };
        });
        writeFavoriteItemsCount(result.libraryTotal);
        setSkeletonCount(Math.min(result.libraryTotal, FAVORITE_RENDER_CHUNK));
      } catch (error) {
        if (
          generation.current === currentGeneration &&
          !controller.signal.aborted
        ) {
          if (!cursor) {
            firstPages.current.delete(pageKey);
            setPage(null);
          }
          setError(
            error instanceof Error ? error.message : '收藏加载失败，请重试',
          );
        }
      } finally {
        if (generation.current === currentGeneration) {
          request.current = null;
          setPending(false);
          setLoadingMore(false);
        }
      }
    },
    [query, options.filter, options.sort],
  );

  useEffect(() => {
    if (!queryPending) void fetchPage();
    return () => {
      generation.current += 1;
      request.current?.controller.abort();
      request.current = null;
    };
  }, [fetchPage, profileId, version, queryPending]);

  const loadMore = useCallback(() => {
    if (!request.current && page?.nextCursor && !queryPending)
      void fetchPage(page.nextCursor);
  }, [fetchPage, page, queryPending]);
  const items = useMemo<FavoriteItem[]>(
    () =>
      (page?.items ?? []).flatMap(
        ({
          key,
          favorite,
          playRecord,
          myRating,
          watchStatus,
          watchStatusManual,
          watchedAt,
        }) => {
          const parsed = parseStorageKey(key);
          return parsed
            ? [
                {
                  id: parsed.id,
                  source: parsed.source,
                  title: favorite.title,
                  year: favorite.year,
                  poster: favorite.cover,
                  episodes: favorite.total_episodes,
                  source_name: favorite.source_name,
                  currentEpisode: playRecord?.index,
                  progress:
                    playRecord && playRecord.total_time > 0
                      ? (playRecord.play_time / playRecord.total_time) * 100
                      : 0,
                  search_title: favorite.search_title,
                  origin: favorite.origin,
                  myRating: myRating ?? undefined,
                  watchStatus,
                  watchStatusManual,
                  watchedAt,
                },
              ]
            : [];
        },
      ),
    [page],
  );
  const clearFavorites = useCallback(async () => {
    await clearAllFavorites();
    writeFavoriteItemsCount(0);
    refresh();
  }, [refresh]);

  return {
    items,
    // loading 仅指尚无任何结果的首次加载；已有结果时的重新查询走 refreshing
    loading: page === null && (pending || queryPending),
    refreshing: page !== null && (pending || queryPending),
    loadingMore,
    error,
    retry: refresh,
    skeletonCount,
    clearFavorites,
    counts: page?.counts ?? EMPTY_FAVORITE_COUNTS,
    total: page?.total ?? 0,
    libraryTotal: page?.libraryTotal ?? 0,
    hasMore: Boolean(page?.nextCursor),
    loadMore,
  };
}
