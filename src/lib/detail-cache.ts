import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import type { ApiSite } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import { getSourceCacheKey } from '@/lib/source-cache-key';
import type { SearchResult } from '@/lib/types';

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const DETAIL_FRESH_MS = IS_DEVELOPMENT ? 10 * 1000 : 10 * 60 * 1000;
const DETAIL_STALE_MS = IS_DEVELOPMENT ? 10 * 1000 : 20 * 60 * 1000;
const DETAIL_CACHE = createSharedServerCache<SearchResult>({
  name: 'detail',
  freshMs: DETAIL_FRESH_MS,
  staleMs: DETAIL_STALE_MS,
  ...getServerCacheBudget('detail'),
  maxWaitMs: 12_000,
});

function makeDetailCacheKey(sourceKey: string, id: string): string {
  return `${sourceKey}::${id}`;
}

export function getCachedDetail(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  return DETAIL_CACHE.getOrLoad(
    makeDetailCacheKey(getSourceCacheKey(apiSite), id),
    () => getDetailFromApi(apiSite, id),
  );
}

export function getDetailCacheStats() {
  return DETAIL_CACHE.stats();
}

export function clearDetailCacheForTests(): void {
  DETAIL_CACHE.clear();
}
