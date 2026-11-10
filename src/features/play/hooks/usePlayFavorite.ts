import { MutableRefObject, useRef } from 'react';

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

  const pendingRef = useRef(false);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (pendingRef.current) return;
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    const source = currentSourceRef.current;
    const id = currentIdRef.current;
    pendingRef.current = true;
    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        if (currentSourceRef.current === source && currentIdRef.current === id)
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
        if (currentSourceRef.current === source && currentIdRef.current === id)
          setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    } finally {
      pendingRef.current = false;
    }
  };

  return { handleToggleFavorite };
}
