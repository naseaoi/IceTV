import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { createSwrCache } from '@/lib/server-cache';
import { DoubanResult } from '@/lib/types';

export const doubanRouteCache = createSwrCache<DoubanResult>({
  name: 'douban-route',
  freshMs: 30 * 60 * 1000,
  staleMs: 30 * 60 * 1000,
  ...getServerCacheBudget('douban-route'),
});

export function getDoubanRouteCacheStats() {
  return doubanRouteCache.stats();
}
