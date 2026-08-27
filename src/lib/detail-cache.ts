import type { ApiSite } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { createSwrCache } from '@/lib/server-cache';
import type { SearchResult } from '@/lib/types';

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const DETAIL_FRESH_MS = IS_DEVELOPMENT ? 10 * 1000 : 10 * 60 * 1000;
const DETAIL_STALE_MS = IS_DEVELOPMENT ? 10 * 1000 : 20 * 60 * 1000;
const DETAIL_MAX_SIZE = 2000;
const DETAIL_MAX_BYTES = 48 * 1024 * 1024;

const DETAIL_CACHE = createSwrCache<SearchResult>({
  name: 'detail',
  freshMs: DETAIL_FRESH_MS,
  staleMs: DETAIL_STALE_MS,
  maxSize: DETAIL_MAX_SIZE,
  maxWeightBytes: DETAIL_MAX_BYTES,
});

function makeDetailCacheKey(sourceKey: string, id: string): string {
  return `${sourceKey}::${id}`;
}

export function getCachedDetail(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  return DETAIL_CACHE.getOrLoad(makeDetailCacheKey(apiSite.key, id), () =>
    getDetailFromApi(apiSite, id),
  );
}

export function getDetailCacheStats() {
  return DETAIL_CACHE.stats();
}

export function clearDetailCacheForTests(): void {
  DETAIL_CACHE.clear();
}
