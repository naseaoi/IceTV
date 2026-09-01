import type {
  DanmakuFetchResult,
  DanmakuMatchCandidate,
} from '@/features/play/lib/danmaku/types';
import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { createSwrCache } from '@/lib/server-cache';

// 上游明确要求缓存，常规 2 小时新鲜、6 小时可陈旧
export const danmakuCommentsCache = createSwrCache<DanmakuFetchResult>({
  name: 'danmaku-comments',
  freshMs: 2 * 60 * 60 * 1000,
  staleMs: 6 * 60 * 60 * 1000,
  ...getServerCacheBudget('danmaku-comments'),
});

export const danmakuSearchCache = createSwrCache<DanmakuMatchCandidate[]>({
  name: 'danmaku-search',
  freshMs: 30 * 60 * 1000,
  staleMs: 2 * 60 * 60 * 1000,
  ...getServerCacheBudget('danmaku-search'),
});

export function getDanmakuCommentsCacheStats() {
  return danmakuCommentsCache.stats();
}

export function getDanmakuSearchCacheStats() {
  return danmakuSearchCache.stats();
}
