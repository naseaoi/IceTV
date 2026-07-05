'use client';

import { useEffect, useState } from 'react';

import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  getCachedFavoritesSnapshot,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { isClientHydrated } from '@/lib/client-hydration';
import type { Favorite } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

import type { FavoriteItem } from '@/features/favorites/types';

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

function readInitialFavoriteItems(): FavoriteItem[] | null {
  return isClientHydrated() ? readCachedFavoriteItems() : null;
}

export function useFavoriteItems(enabled: boolean) {
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>(
    () => readInitialFavoriteItems() || [],
  );
  const [loading, setLoading] = useState(
    () => enabled && !readInitialFavoriteItems(),
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const cachedItems = readCachedFavoriteItems();
    if (cachedItems) {
      setFavoriteItems(cachedItems);
    }
    setLoading(!cachedItems);

    const loadFavorites = async (favorites?: Record<string, Favorite>) => {
      try {
        const allFavorites = favorites || (await getAllFavorites());
        const items = await buildFavoriteItems(allFavorites);
        if (!cancelled) {
          setFavoriteItems(items);
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
  }, [enabled]);

  const clearFavorites = async () => {
    await clearAllFavorites();
    setFavoriteItems([]);
  };

  return {
    favoriteItems,
    loading,
    clearFavorites,
  };
}
