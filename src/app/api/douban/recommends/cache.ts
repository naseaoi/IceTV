import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { createSwrCache } from '@/lib/server-cache';
import { DoubanResult } from '@/lib/types';

// 进程内 SWR 缓存：同参数请求合并回源 + 软过期后台刷新
// 豆瓣推荐变化缓慢，新鲜 30 分钟、软过期再 30 分钟内返回旧值
export const recommendsCache = createSwrCache<DoubanResult>({
  name: 'douban-recommends',
  freshMs: 30 * 60 * 1000,
  staleMs: 30 * 60 * 1000,
  ...getServerCacheBudget('douban-recommends'),
});

export function getDoubanRecommendsCacheStats() {
  return recommendsCache.stats();
}
