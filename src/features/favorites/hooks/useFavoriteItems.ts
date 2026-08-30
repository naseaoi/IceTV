'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import type { FavoriteItem } from '@/features/favorites/types';
import {
  clearAllFavorites,
  getCachedFavoritesSnapshot,
  getCachedPlayRecordsSnapshot,
  getFavoritePage,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { normalizeFavoriteLimit } from '@/lib/favorites';
import {
  readFavoriteItemsCount,
  writeFavoriteItemsCount,
} from '@/lib/local-preferences';
import type { FavoritePageItem, PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const MAX_FAVORITE_SKELETON_COUNT = 8;
const DEFAULT_FAVORITE_ITEMS_LIMIT = 20;
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function buildFavoriteItem(
  key: string,
  favorite: FavoritePageItem['favorite'],
  playRecord?: PlayRecord,
): FavoriteItem | null {
  const parsedKey = parseStorageKey(key);
  if (!parsedKey) return null;

  return {
    id: parsedKey.id,
    source: parsedKey.source,
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
  };
}

function buildFavoritePageItems(items: FavoritePageItem[]): FavoriteItem[] {
  return items.flatMap(({ key, favorite, playRecord }) => {
    const item = buildFavoriteItem(key, favorite, playRecord);
    return item ? [item] : [];
  });
}

function readCachedFavoriteItems(limit: number): {
  items: FavoriteItem[];
  total: number;
} | null {
  const cachedFavorites = getCachedFavoritesSnapshot();
  if (!cachedFavorites) return null;
  const cachedPlayRecords = getCachedPlayRecordsSnapshot() || {};
  const entries = Object.entries(cachedFavorites)
    .sort(([leftKey, left], [rightKey, right]) => {
      return (
        right.save_time - left.save_time || rightKey.localeCompare(leftKey)
      );
    })
    .slice(0, limit);

  return {
    items: entries.flatMap(([key, favorite]) => {
      const item = buildFavoriteItem(key, favorite, cachedPlayRecords[key]);
      return item ? [item] : [];
    }),
    total: Object.keys(cachedFavorites).length,
  };
}

export function useFavoriteItems(
  enabled: boolean,
  initialSkeletonCount = 0,
  pageLimit = DEFAULT_FAVORITE_ITEMS_LIMIT,
) {
  const limit = useMemo(() => normalizeFavoriteLimit(pageLimit), [pageLimit]);
  const normalizedInitialSkeletonCount = Math.min(
    Math.max(0, Math.floor(initialSkeletonCount)),
    MAX_FAVORITE_SKELETON_COUNT,
  );
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(
    () => enabled && normalizedInitialSkeletonCount > 0,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [skeletonCount, setSkeletonCount] = useState(
    normalizedInitialSkeletonCount,
  );

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;

    const cached = readCachedFavoriteItems(limit);
    if (cached) {
      setFavoriteItems(cached.items);
      setTotal(cached.total);
      setSkeletonCount(
        Math.min(cached.items.length, MAX_FAVORITE_SKELETON_COUNT),
      );
      setLoading(false);
      return;
    }

    const nextSkeletonCount = Math.min(
      Math.max(normalizedInitialSkeletonCount, readFavoriteItemsCount()),
      MAX_FAVORITE_SKELETON_COUNT,
    );
    setSkeletonCount(nextSkeletonCount);
    setLoading(nextSkeletonCount > 0);
  }, [enabled, limit, normalizedInitialSkeletonCount]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const page = await getFavoritePage(limit);
        if (cancelled) return;
        const items = buildFavoritePageItems(page.items);
        setFavoriteItems(items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setSkeletonCount(Math.min(items.length, MAX_FAVORITE_SKELETON_COUNT));
        writeFavoriteItemsCount(page.total);
      } catch (error) {
        console.error('获取收藏失败:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();
    const unsubscribe = subscribeToDataUpdates('favoritesUpdated', () => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, limit]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getFavoritePage(limit, nextCursor);
      const nextItems = buildFavoritePageItems(page.items);
      setFavoriteItems((current) => {
        const existing = new Set(
          current.map((item) => `${item.source}+${item.id}`),
        );
        return [
          ...current,
          ...nextItems.filter(
            (item) => !existing.has(`${item.source}+${item.id}`),
          ),
        ];
      });
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      writeFavoriteItemsCount(page.total);
    } catch (error) {
      console.error('加载更多收藏失败:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [limit, loadingMore, nextCursor]);

  const clearFavorites = useCallback(async () => {
    await clearAllFavorites();
    setFavoriteItems([]);
    setTotal(0);
    setNextCursor(null);
    setSkeletonCount(0);
    writeFavoriteItemsCount(0);
  }, []);

  return {
    favoriteItems,
    total,
    loading,
    loadingMore,
    skeletonCount,
    hasMore: nextCursor !== null,
    loadMore,
    clearFavorites,
  };
}
