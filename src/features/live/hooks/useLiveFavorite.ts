import { MutableRefObject, useRef, useState } from 'react';

import { useFavoriteSync } from '@/hooks/useFavoriteSync';
import { deleteFavorite, saveFavorite } from '@/lib/db.client';

import type { LiveChannel, LiveSource } from '../types';

interface UseLiveFavoriteParams {
  currentSource: LiveSource | null;
  currentChannel: LiveChannel | null;
  currentSourceRef: MutableRefObject<LiveSource | null>;
  currentChannelRef: MutableRefObject<LiveChannel | null>;
}

export function useLiveFavorite({
  currentSource,
  currentChannel,
  currentSourceRef,
  currentChannelRef,
}: UseLiveFavoriteParams) {
  const [favorited, setFavorited] = useState(false);
  const favoritedRef = useRef(false);

  // 复用通用的"检查+订阅"逻辑，拼接 live_ 前缀
  const liveSource = currentSource ? `live_${currentSource.key}` : null;
  const liveId = currentChannel ? `live_${currentChannel.id}` : null;
  useFavoriteSync(liveSource, liveId, setFavorited, (isFav) => {
    favoritedRef.current = isFav;
  });

  // 切换收藏（乐观更新 + 回滚）
  const handleToggleFavorite = async () => {
    if (!currentSourceRef.current || !currentChannelRef.current) return;

    try {
      const currentFavorited = favoritedRef.current;
      const newFavorited = !currentFavorited;

      // 立即更新状态
      setFavorited(newFavorited);
      favoritedRef.current = newFavorited;

      try {
        if (newFavorited) {
          await saveFavorite(
            `live_${currentSourceRef.current.key}`,
            `live_${currentChannelRef.current.id}`,
            {
              title: currentChannelRef.current.name,
              source_name: currentSourceRef.current.name,
              year: '',
              cover: `/api/proxy/logo?url=${encodeURIComponent(currentChannelRef.current.logo)}&icetv-source=${currentSourceRef.current.key}`,
              total_episodes: 1,
              save_time: Date.now(),
              search_title: '',
              origin: 'live',
            },
          );
        } else {
          await deleteFavorite(
            `live_${currentSourceRef.current.key}`,
            `live_${currentChannelRef.current.id}`,
          );
        }
      } catch (err) {
        console.error('收藏操作失败:', err);
        // 操作失败，回滚状态
        setFavorited(currentFavorited);
        favoritedRef.current = currentFavorited;
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  return { favorited, handleToggleFavorite };
}
