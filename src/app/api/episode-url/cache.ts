import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { createSwrCache } from '@/lib/server-cache';

export const episodeUrlCache = createSwrCache<string>({
  name: 'episode-url',
  freshMs: 30 * 60 * 1000,
  staleMs: 2 * 60 * 60 * 1000,
  ...getServerCacheBudget('episode-url'),
});

export function getEpisodeUrlCacheStats() {
  return episodeUrlCache.stats();
}
