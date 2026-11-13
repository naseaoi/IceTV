import { socialRequest } from '@/lib/profile.client';
import type { FavoriteWatchStatus, PublicUserRef } from '@/lib/types';

export interface FollowedOpinion {
  author: PublicUserRef;
  status: FavoriteWatchStatus | null;
  rating: number | null;
  hasPublicReview: boolean;
}

export interface FollowedOpinions {
  watchedCount: number;
  ratedCount: number;
  averageRating: number | null;
  items: FollowedOpinion[];
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<
  string,
  { at: number; promise: Promise<FollowedOpinions> }
>();

// 切换面板标签会重新挂载简介，短时缓存避免同一作品重复请求
export function fetchFollowedOpinions(title: string, year: string) {
  const key = `${title}\u0000${year}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = socialRequest<FollowedOpinions>(
    `/api/follows/opinions?${new URLSearchParams({ title, year })}`,
  );
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}
