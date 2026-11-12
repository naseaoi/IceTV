'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import {
  fetchFavoriteLibraryPage,
  toFavoriteItem,
} from '@/features/favorites/lib/library-client';
import type { FavoriteItem } from '@/features/favorites/types';
import {
  getCachedFavoritesSnapshot,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { FAVORITE_PREVIEW_LIMIT } from '@/lib/favorites-count';
import {
  readFavoriteItemsCount,
  writeFavoriteItemsCount,
} from '@/lib/local-preferences';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// 本标签页已有全量收藏缓存时先用它渲染，避免返回页面时闪骨架；随后仍以收藏库接口结果为准
function readCachedFavoriteItems(): FavoriteItem[] | null {
  const cachedFavorites = getCachedFavoritesSnapshot();
  if (!cachedFavorites) return null;
  const cachedPlayRecords = getCachedPlayRecordsSnapshot() || {};
  return Object.entries(cachedFavorites)
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        right.save_time - left.save_time || rightKey.localeCompare(leftKey),
    )
    .slice(0, FAVORITE_PREVIEW_LIMIT)
    .flatMap(([key, favorite]) => {
      const item = toFavoriteItem({
        key,
        favorite,
        playRecord: cachedPlayRecords[key],
      });
      return item ? [item] : [];
    });
}

// 「我的」页收藏栏：与收藏库同一查询，只取最近收藏的前几条
export function useFavoriteItems(initialSkeletonCount = 0) {
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [total, setTotal] = useState(0);
  // 首次请求返回前一律视为加载中，避免先闪出空态
  const [loading, setLoading] = useState(true);
  const [skeletonCount, setSkeletonCount] = useState(
    Math.min(
      Math.max(0, Math.floor(initialSkeletonCount)),
      FAVORITE_PREVIEW_LIMIT,
    ),
  );

  useIsomorphicLayoutEffect(() => {
    const cached = readCachedFavoriteItems();
    if (cached) {
      setFavoriteItems(cached);
      setTotal(Math.max(readFavoriteItemsCount(), cached.length));
      setSkeletonCount(cached.length);
      setLoading(false);
      return;
    }
    setSkeletonCount((current) =>
      Math.min(
        Math.max(current, readFavoriteItemsCount()),
        FAVORITE_PREVIEW_LIMIT,
      ),
    );
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const page = await fetchFavoriteLibraryPage(
          {
            query: '',
            filter: 'all',
            sort: 'saved',
            limit: FAVORITE_PREVIEW_LIMIT,
          },
          current.signal,
        );
        if (current.signal.aborted) return;
        const items = page.items.flatMap((entry) => {
          const item = toFavoriteItem(entry);
          return item ? [item] : [];
        });
        setFavoriteItems(items);
        setTotal(page.libraryTotal);
        setSkeletonCount(items.length);
        writeFavoriteItemsCount(page.libraryTotal);
      } catch (error) {
        if (current.signal.aborted) return;
        console.error('获取收藏失败:', error);
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    };

    void refresh();
    const unsubscribe = subscribeToDataUpdates('favoritesUpdated', () => {
      void refresh();
    });
    return () => {
      controller?.abort();
      unsubscribe();
    };
  }, []);

  return {
    favoriteItems,
    total,
    loading,
    skeletonCount,
  };
}
