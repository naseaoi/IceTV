import { Dispatch, SetStateAction, useEffect } from 'react';

import {
  generateStorageKey,
  isFavorited as checkIsFavorited,
  subscribeToDataUpdates,
} from '@/lib/db.client';

/**
 * 通用收藏状态监听 hook
 * 封装"初始检查 + 事件订阅"两段重复逻辑，供 VOD/Live 收藏 hook 复用。
 */
export function useFavoriteSync(
  source: string | undefined | null,
  id: string | undefined | null,
  setFavorited: Dispatch<SetStateAction<boolean>>,
  /** 额外的状态同步回调（如 Live 的 ref 同步） */
  onSync?: (isFav: boolean) => void,
) {
  // 检查初始收藏状态
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
  }, [source, id]);

  // 订阅收藏数据变化事件
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
  }, [source, id]);
}
