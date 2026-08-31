import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import type { ApiSite } from '@/lib/config';
import { createSwrCache } from '@/lib/server-cache';
import { SearchResult } from '@/lib/types';

export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

export interface CachedPageEntry {
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number;
}

export interface SearchAggregateCacheParams {
  query: string;
  apiSites: ApiSite[];
  maxSearchPages: number;
  disableYellowFilter: boolean;
}

export interface CachedSearchAggregateEntry {
  results: SearchResult[];
}

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_STALE_MS = 10 * 60 * 1000;
const SEARCH_EMPTY_CACHE_TTL_MS = 60 * 1000;
const SEARCH_EMPTY_CACHE_STALE_MS = 60 * 1000;
const SEARCH_AGGREGATE_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_AGGREGATE_CACHE_STALE_MS = 3 * 60 * 1000;
const SEARCH_CACHE = createSwrCache<CachedPageEntry>({
  name: 'search-pages',
  ...getServerCacheBudget('search-pages'),
  freshMs: SEARCH_CACHE_TTL_MS,
  staleMs: SEARCH_CACHE_STALE_MS,
});
const SEARCH_EMPTY_CACHE = createSwrCache<CachedPageEntry>({
  name: 'search-empty-pages',
  ...getServerCacheBudget('search-empty-pages'),
  freshMs: SEARCH_EMPTY_CACHE_TTL_MS,
  staleMs: SEARCH_EMPTY_CACHE_STALE_MS,
});
const SEARCH_AGGREGATE_CACHE = createSwrCache<CachedSearchAggregateEntry>({
  name: 'search-aggregates',
  ...getServerCacheBudget('search-aggregates'),
  freshMs: SEARCH_AGGREGATE_CACHE_TTL_MS,
  staleMs: SEARCH_AGGREGATE_CACHE_STALE_MS,
});
const SEARCH_AGGREGATE_REFRESH_INFLIGHT: Map<string, Promise<void>> = new Map();
const SEARCH_AGGREGATE_LOAD_INFLIGHT: Map<
  string,
  Promise<SearchResult[]>
> = new Map();

const SEARCH_INFLIGHT: Map<
  string,
  Promise<{ results: SearchResult[]; pageCount?: number }>
> = new Map();

function makeSearchCacheKey(
  sourceKey: string,
  query: string,
  page: number,
): string {
  return `${sourceKey}::${query.trim()}::${page}`;
}

function makeSearchAggregateCacheKey(
  params: SearchAggregateCacheParams,
): string {
  const sourceKey = JSON.stringify(
    params.apiSites.map((site) => [
      site.key,
      site.name,
      site.api,
      site.detail || '',
    ]),
  );

  return JSON.stringify([
    params.query.trim(),
    params.maxSearchPages,
    params.disableYellowFilter ? 'yellow-off' : 'yellow-on',
    sourceKey,
  ]);
}

export function peekCachedSearchAggregate(
  params: SearchAggregateCacheParams,
): { entry: CachedSearchAggregateEntry; fresh: boolean } | null {
  const key = makeSearchAggregateCacheKey(params);
  const cached = SEARCH_AGGREGATE_CACHE.peek(key);
  return cached ? { entry: cached.value, fresh: cached.fresh } : null;
}

export function setCachedSearchAggregate(
  params: SearchAggregateCacheParams,
  results: SearchResult[],
): void {
  if (results.length === 0) return;

  const key = makeSearchAggregateCacheKey(params);
  SEARCH_AGGREGATE_CACHE.set(key, { results });
}

export function refreshCachedSearchAggregate(
  params: SearchAggregateCacheParams,
  loader: () => Promise<SearchResult[]>,
): Promise<void> {
  const key = makeSearchAggregateCacheKey(params);
  const existing = SEARCH_AGGREGATE_REFRESH_INFLIGHT.get(key);
  if (existing) return existing;

  const task = loader()
    .then((results) => {
      setCachedSearchAggregate(params, results);
    })
    .finally(() => {
      SEARCH_AGGREGATE_REFRESH_INFLIGHT.delete(key);
    });

  SEARCH_AGGREGATE_REFRESH_INFLIGHT.set(key, task);
  return task;
}

export function loadCachedSearchAggregate(
  params: SearchAggregateCacheParams,
  loader: () => Promise<SearchResult[]>,
): Promise<SearchResult[]> {
  const key = makeSearchAggregateCacheKey(params);
  const existing = SEARCH_AGGREGATE_LOAD_INFLIGHT.get(key);
  if (existing) return existing;

  const task = loader()
    .then((results) => {
      setCachedSearchAggregate(params, results);
      return results;
    })
    .finally(() => {
      SEARCH_AGGREGATE_LOAD_INFLIGHT.delete(key);
    });

  SEARCH_AGGREGATE_LOAD_INFLIGHT.set(key, task);
  return task;
}

export function peekCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
): { entry: CachedPageEntry; fresh: boolean } | null {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const cached = SEARCH_CACHE.peek(key) || SEARCH_EMPTY_CACHE.peek(key);
  return cached ? { entry: cached.value, fresh: cached.fresh } : null;
}

export function dedupeSearchLoad(
  sourceKey: string,
  query: string,
  page: number,
  loader: () => Promise<{ results: SearchResult[]; pageCount?: number }>,
): Promise<{ results: SearchResult[]; pageCount?: number }> {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const existing = SEARCH_INFLIGHT.get(key);
  if (existing) return existing;
  const p = loader().finally(() => {
    SEARCH_INFLIGHT.delete(key);
  });
  SEARCH_INFLIGHT.set(key, p);
  return p;
}

export function getCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
): CachedPageEntry | null {
  const cached = peekCachedSearchPage(sourceKey, query, page);
  return cached?.fresh ? cached.entry : null;
}

export function setCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number,
): void {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry = {
    status,
    data,
    pageCount,
  };
  if (status === 'ok' && data.length === 0) {
    SEARCH_CACHE.invalidate(key);
    SEARCH_EMPTY_CACHE.set(key, entry);
  } else {
    SEARCH_EMPTY_CACHE.invalidate(key);
    SEARCH_CACHE.set(key, entry);
  }
}

export function getSearchCacheStats() {
  return {
    pages: SEARCH_CACHE.stats(),
    emptyPages: SEARCH_EMPTY_CACHE.stats(),
    aggregates: SEARCH_AGGREGATE_CACHE.stats(),
  };
}

export function clearSearchCachesForTests(): void {
  SEARCH_CACHE.clear();
  SEARCH_EMPTY_CACHE.clear();
  SEARCH_AGGREGATE_CACHE.clear();
  SEARCH_INFLIGHT.clear();
  SEARCH_AGGREGATE_REFRESH_INFLIGHT.clear();
  SEARCH_AGGREGATE_LOAD_INFLIGHT.clear();
}
