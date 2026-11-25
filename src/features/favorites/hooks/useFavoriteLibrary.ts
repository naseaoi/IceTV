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
  FavoriteReviewFilter,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import {
  fetchFavoriteLibraryPage,
  toFavoriteItem,
} from '@/features/favorites/lib/library-client';
import type { FavoriteItem } from '@/features/favorites/types';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { clearAllFavorites, subscribeToDataUpdates } from '@/lib/db.client';
import { FAVORITE_RENDER_CHUNK } from '@/lib/favorites-count';
import {
  readFavoriteItemsCount,
  writeFavoriteItemsCount,
} from '@/lib/local-preferences';
import { VIDEO_REVIEWS_UPDATED_EVENT } from '@/lib/video-reviews';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useFavoriteLibrary(
  initialSkeletonCount = 0,
  options: {
    query: string;
    filter: FavoriteFilter;
    review?: FavoriteReviewFilter;
    sort: FavoriteSort;
  } = {
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
    async (cursor: string | undefined, signal: AbortSignal) => ({
      ...(await fetchFavoriteLibraryPage(
        {
          query,
          filter: options.filter,
          review: options.review,
          sort: options.sort,
          cursor,
        },
        signal,
      )),
      query,
      narrowed:
        query.trim() !== '' ||
        options.filter !== 'all' ||
        (options.review ?? 'all') !== 'all',
    }),
    [query, options.filter, options.review, options.sort],
  );
  const {
    data: page,
    currentData,
    initialLoading,
    refreshing,
    loadingMore,
    error,
    refresh,
    retry,
    loadMore,
  } = usePagedQuery({
    scopeKey: profileId,
    queryKey: JSON.stringify([
      query,
      options.filter,
      options.review,
      options.sort,
    ]),
    enabled: !queryPending,
    fetchPage,
    getItemKey: (item) => item.key,
  });

  useEffect(() => {
    if (!currentData) return;
    writeFavoriteItemsCount(currentData.libraryTotal);
    setSkeletonCount(Math.min(currentData.libraryTotal, FAVORITE_RENDER_CHUNK));
  }, [currentData]);

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
      (page?.items ?? []).flatMap((entry) => {
        const item = toFavoriteItem(entry);
        return item
          ? [
              {
                ...item,
                myRating: entry.myRating ?? undefined,
                watchStatus: entry.watchStatus,
                watchStatusManual: entry.watchStatusManual,
                watchedAt: entry.watchedAt,
              },
            ]
          : [];
      }),
    [page],
  );
  const clearFavorites = useCallback(async () => {
    await clearAllFavorites();
    writeFavoriteItemsCount(0);
    refresh();
  }, [refresh]);

  return {
    items,
    displayPage: page,
    // loading 仅指尚无任何结果的首次加载；已有结果时的重新查询走 refreshing
    loading: initialLoading || (page === null && queryPending),
    refreshing: refreshing || (page !== null && queryPending),
    loadingMore,
    error: error ? '收藏加载失败，请重试' : null,
    retry,
    countsLoading: !currentData || queryPending,
    skeletonCount:
      currentData && !queryPending
        ? Math.min(currentData.total, FAVORITE_RENDER_CHUNK)
        : options.query.trim() ||
            options.filter !== 'all' ||
            (options.review ?? 'all') !== 'all'
          ? null
          : skeletonCount,
    clearFavorites,
    canOperate: currentData !== null && !queryPending && !refreshing,
    counts: currentData?.counts ?? EMPTY_FAVORITE_COUNTS,
    total: currentData?.total ?? 0,
    libraryTotal: currentData?.libraryTotal ?? 0,
    hasMore: Boolean(currentData?.nextCursor),
    loadMore,
  };
}
