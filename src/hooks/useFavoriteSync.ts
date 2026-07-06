import { Dispatch, SetStateAction, useEffect } from 'react';

import {
  generateStorageKey,
  isFavorited as checkIsFavorited,
  subscribeToDataUpdates,
} from '@/lib/db.client';

export function useFavoriteSync(
  source: string | undefined | null,
  id: string | undefined | null,
  setFavorited: Dispatch<SetStateAction<boolean>>,
  onSync?: (isFav: boolean) => void,
) {
  // 初始收藏状态
  useEffect(() => {
    if (!source || !id) return;
    (async () => {
      try {
        const fav = await checkIsFavorited(source, id);
        setFavorited(fav);
        onSync?.(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [source, id, onSync, setFavorited]);

  // 收藏数据变化订阅
  useEffect(() => {
    if (!source || !id) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, unknown>) => {
        const key = generateStorageKey(source, id);
        const isFav = !!favorites[key];
        setFavorited(isFav);
        onSync?.(isFav);
      },
    );

    return unsubscribe;
  }, [source, id, onSync, setFavorited]);
}
