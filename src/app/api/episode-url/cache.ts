import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import type { ApiSite } from '@/lib/config';
import { createSwrCache } from '@/lib/server-cache';
import { getSourceCacheKey } from '@/lib/source-cache-key';

export function getEpisodeUrlCacheKey(apiSite: ApiSite, lazyUrl: string) {
  return JSON.stringify([getSourceCacheKey(apiSite), lazyUrl]);
}

export const episodeUrlCache = createSwrCache<string>({
  name: 'episode-url',
  freshMs: 30 * 60 * 1000,
  staleMs: 2 * 60 * 60 * 1000,
  ...getServerCacheBudget('episode-url'),
});

export function getEpisodeUrlCacheStats() {
  return episodeUrlCache.stats();
}
