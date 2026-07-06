import { MutableRefObject } from 'react';

import { useFavoriteSync } from '@/hooks/useFavoriteSync';
import { deleteFavorite, saveFavorite } from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

interface UsePlayFavoriteParams {
  currentSource: string;
  currentId: string;
  searchTitle: string;
  videoTitleRef: MutableRefObject<string>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  favorited: boolean;
  setFavorited: React.Dispatch<React.SetStateAction<boolean>>;
}

export function usePlayFavorite({
  currentSource,
  currentId,
  searchTitle,
  videoTitleRef,
  detailRef,
  currentSourceRef,
  currentIdRef,
  favorited,
  setFavorited,
}: UsePlayFavoriteParams) {
  // 复用通用的"检查+订阅"逻辑
  useFavoriteSync(currentSource, currentId, setFavorited);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  return { handleToggleFavorite };
}
