'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import type { FavoriteItem } from '@/features/favorites/types';
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  getCachedFavoritesSnapshot,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { FAVORITE_ITEMS_COUNT_COOKIE } from '@/lib/favorites-count';
import type { Favorite } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const FAVORITE_ITEMS_COUNT_STORAGE_KEY = 'favoriteItemsCount';
const MAX_FAVORITE_SKELETON_COUNT = 8;
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function buildFavoriteItemsFromRecords(
  allFavorites: Record<string, Favorite>,
  allPlayRecords: Awaited<ReturnType<typeof getAllPlayRecords>>,
): FavoriteItem[] {
  return Object.entries(allFavorites)
    .sort(([, a], [, b]) => b.save_time - a.save_time)
    .flatMap(([key, fav]) => {
      const parsedKey = parseStorageKey(key);
      if (!parsedKey) return [];

      const playRecord = allPlayRecords[key];
      return [
        {
          id: parsedKey.id,
          source: parsedKey.source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode: playRecord?.index,
          progress:
            playRecord?.total_time > 0
              ? (playRecord.play_time / playRecord.total_time) * 100
              : 0,
          search_title: fav.search_title,
          origin: fav.origin,
        },
      ];
    });
}

async function buildFavoriteItems(
  allFavorites: Record<string, Favorite>,
): Promise<FavoriteItem[]> {
  const allPlayRecords = await getAllPlayRecords();
  return buildFavoriteItemsFromRecords(allFavorites, allPlayRecords);
}

function readCachedFavoriteItems(): FavoriteItem[] | null {
  const cachedFavorites = getCachedFavoritesSnapshot();
  if (!cachedFavorites) return null;
  return buildFavoriteItemsFromRecords(
    cachedFavorites,
    getCachedPlayRecordsSnapshot() || {},
  );
}

function readClientSkeletonCount(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const cachedItems = readCachedFavoriteItems();
  if (cachedItems) {
    return Math.min(cachedItems.length, MAX_FAVORITE_SKELETON_COUNT);
  }

  const savedCount = Number.parseInt(
    window.localStorage.getItem(FAVORITE_ITEMS_COUNT_STORAGE_KEY) || '0',
    10,
  );
  return Number.isFinite(savedCount) && savedCount > 0
    ? Math.min(savedCount, MAX_FAVORITE_SKELETON_COUNT)
    : 0;
}

function writeFavoriteItemsCount(count: number) {
  if (typeof window === 'undefined') {
    return;
  }

  const safeCount = Math.max(0, Math.floor(count));
  try {
    window.localStorage.setItem(
      FAVORITE_ITEMS_COUNT_STORAGE_KEY,
      String(safeCount),
    );
  } catch {}

  if (safeCount > 0) {
    document.cookie = `${FAVORITE_ITEMS_COUNT_COOKIE}=${safeCount};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
  } else {
    document.cookie = `${FAVORITE_ITEMS_COUNT_COOKIE}=0;path=/;max-age=0;samesite=lax`;
  }
}

export function useFavoriteItems(enabled: boolean, initialSkeletonCount = 0) {
  const normalizedInitialSkeletonCount = Math.min(
    Math.max(0, Math.floor(initialSkeletonCount)),
    MAX_FAVORITE_SKELETON_COUNT,
  );
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(
    () => enabled && normalizedInitialSkeletonCount > 0,
  );
  const [skeletonCount, setSkeletonCount] = useState(
    normalizedInitialSkeletonCount,
  );

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;

    const cachedItems = readCachedFavoriteItems();
    if (cachedItems) {
      setSkeletonCount(
        Math.min(cachedItems.length, MAX_FAVORITE_SKELETON_COUNT),
      );
      setFavoriteItems(cachedItems);
      setLoading(false);
      return;
    }

    const clientSkeletonCount = Math.max(
      normalizedInitialSkeletonCount,
      readClientSkeletonCount(),
    );
    setSkeletonCount(clientSkeletonCount);
    setLoading(clientSkeletonCount > 0);
  }, [enabled, normalizedInitialSkeletonCount]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const loadFavorites = async (favorites?: Record<string, Favorite>) => {
      try {
        const allFavorites = favorites || (await getAllFavorites());
        const items = await buildFavoriteItems(allFavorites);
        if (!cancelled) {
          setFavoriteItems(items);
          setSkeletonCount(Math.min(items.length, MAX_FAVORITE_SKELETON_COUNT));
          writeFavoriteItemsCount(items.length);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadFavorites();

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, Favorite>) => {
        void loadFavorites(newFavorites);
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, normalizedInitialSkeletonCount]);

  const clearFavorites = async () => {
    await clearAllFavorites();
    setFavoriteItems([]);
    setSkeletonCount(0);
    writeFavoriteItemsCount(0);
  };

  return {
    favoriteItems,
    loading,
    skeletonCount,
    clearFavorites,
  };
}
