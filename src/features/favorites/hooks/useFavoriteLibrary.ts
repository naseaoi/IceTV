'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { usePagedQuery } from '@/hooks/usePagedQuery';
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
  const [skeletonCount, setSkeletonCount] = useState(
    Math.min(Math.max(0, initialSkeletonCount), FAVORITE_RENDER_CHUNK),
  );
  const queryPending = query !== options.query;
  const fetchPage = useCallback(
    async (
      cursor: string | undefined,
      signal: AbortSignal,
    ): Promise<FavoriteLibraryPage> => {
      const params = new URLSearchParams({
        format: 'library',
        q: query,
        filter: options.filter,
        sort: options.sort,
      });
      if (cursor) params.set('cursor', cursor);
      const response = await fetchWithAuth(`/api/favorites?${params}`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('收藏加载失败，请重试');
      return response.json();
    },
    [query, options.filter, options.sort],
  );
  const {
    data: page,
    initialLoading,
    refreshing,
    loadingMore,
    error,
    refresh,
    loadMore,
  } = usePagedQuery({
    scopeKey: profileId,
    queryKey: JSON.stringify([query, options.filter, options.sort]),
    enabled: !queryPending,
    fetchPage,
    getItemKey: (item) => item.key,
  });

  useEffect(() => {
    if (!page) return;
    writeFavoriteItemsCount(page.libraryTotal);
    setSkeletonCount(Math.min(page.libraryTotal, FAVORITE_RENDER_CHUNK));
  }, [page]);

  useIsomorphicLayoutEffect(() => {
    setSkeletonCount((current) =>
      Math.min(
        Math.max(current, readFavoriteItemsCount()),
        FAVORITE_RENDER_CHUNK,
      ),
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(options.query), 250);
    return () => clearTimeout(timer);
  }, [options.query]);

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
    loading: initialLoading || (page === null && queryPending),
    refreshing: refreshing || (page !== null && queryPending),
    loadingMore,
    error: error ? '收藏加载失败，请重试' : null,
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
