'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { buildFavoriteLibrary } from '@/features/favorites/lib/favorite-library';
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  getCachedFavoritesSnapshot,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  readFavoriteItemsCount,
  writeFavoriteItemsCount,
} from '@/lib/local-preferences';
import type { Favorite, PlayRecord, VideoReview } from '@/lib/types';
import { fetchMyVideoReviews } from '@/lib/video-reviews.client';

const MAX_SKELETON_COUNT = 12;
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// 进程内保留上次的评价，再次进入收藏页时评分角标与收藏同帧出现，随后后台刷新
let lastReviews: VideoReview[] | null = null;

// 收藏页需要全量数据做本地搜索、筛选与排序；首页预览仍走分页的 useFavoriteItems
export function useFavoriteLibrary(initialSkeletonCount = 0) {
  const [favorites, setFavorites] = useState<Record<string, Favorite> | null>(
    null,
  );
  const [playRecords, setPlayRecords] = useState<Record<string, PlayRecord>>(
    {},
  );
  const [reviews, setReviews] = useState<VideoReview[] | null>(null);
  const [skeletonCount, setSkeletonCount] = useState(() =>
    Math.min(Math.max(0, initialSkeletonCount), MAX_SKELETON_COUNT),
  );

  // 首帧前读本地缓存，有缓存时直接出内容，不经过骨架屏
  useIsomorphicLayoutEffect(() => {
    const cachedFavorites = getCachedFavoritesSnapshot();
    if (cachedFavorites) {
      setFavorites(cachedFavorites);
      setSkeletonCount(
        Math.min(Object.keys(cachedFavorites).length, MAX_SKELETON_COUNT),
      );
    } else {
      setSkeletonCount((current) =>
        Math.min(
          Math.max(current, readFavoriteItemsCount()),
          MAX_SKELETON_COUNT,
        ),
      );
    }
    setPlayRecords(getCachedPlayRecordsSnapshot() ?? {});
    if (lastReviews) setReviews(lastReviews);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAllFavorites()
      .then((data) => {
        if (cancelled) return;
        setFavorites(data);
        writeFavoriteItemsCount(Object.keys(data).length);
      })
      .catch((error) => {
        console.error('获取收藏失败:', error);
        if (!cancelled) setFavorites((current) => current ?? {});
      });
    void getAllPlayRecords()
      .then((data) => {
        if (!cancelled) setPlayRecords(data);
      })
      .catch((error) => console.error('获取播放记录失败:', error));
    void fetchMyVideoReviews()
      .then((data) => {
        lastReviews = data;
        if (!cancelled) setReviews(data);
      })
      .catch((error) => {
        console.error('获取我的评价失败:', error);
        if (!cancelled) setReviews((current) => current ?? []);
      });

    const unsubscribeFavorites = subscribeToDataUpdates<
      Record<string, Favorite>
    >('favoritesUpdated', (data) => {
      if (data) setFavorites(data);
    });
    const unsubscribePlayRecords = subscribeToDataUpdates<
      Record<string, PlayRecord>
    >('playRecordsUpdated', (data) => {
      if (data) setPlayRecords(data);
    });

    return () => {
      cancelled = true;
      unsubscribeFavorites();
      unsubscribePlayRecords();
    };
  }, []);

  const loading = favorites === null || reviews === null;
  const entries = useMemo(
    () =>
      favorites && reviews
        ? buildFavoriteLibrary(favorites, playRecords, reviews)
        : [],
    [favorites, playRecords, reviews],
  );

  const clearFavorites = useCallback(async () => {
    await clearAllFavorites();
    setFavorites({});
    writeFavoriteItemsCount(0);
  }, []);

  return { entries, loading, skeletonCount, clearFavorites };
}
