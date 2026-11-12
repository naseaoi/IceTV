import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import type { ApiSite } from '@/lib/config';
import { createSwrCache } from '@/lib/server-cache';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import { SearchResult } from '@/lib/types';

export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

export interface CachedPageEntry {
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number;
}

export interface SearchPageLoadResult {
  results: SearchResult[];
  pageCount?: number;
  failed?: boolean;
}

export interface SearchAggregateCacheParams {
  query: string;
  apiSites: ApiSite[];
  maxSearchPages: number;
  disableYellowFilter: boolean;
}

export interface CachedSearchAggregateEntry {
  results: SearchResult[];
  failedSources?: string[];
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
const SEARCH_AGGREGATE_CACHE =
  createSharedServerCache<CachedSearchAggregateEntry>({
    name: 'search-aggregates-v2',
    ...getServerCacheBudget('search-aggregates'),
    freshMs: SEARCH_AGGREGATE_CACHE_TTL_MS,
    staleMs: SEARCH_AGGREGATE_CACHE_STALE_MS,
    maxWaitMs: 20_000,
    shouldCache: (entry) => entry.results.length > 0,
  });
const SEARCH_AGGREGATE_REFRESH_INFLIGHT: Map<string, Promise<void>> = new Map();
const SHARED_SEARCH_PAGES = createSharedServerCache<SearchPageLoadResult>({
  name: 'search-page-shared-v1',
  ...getServerCacheBudget('search-empty-pages'),
  freshMs: 60_000,
  staleMs: 0,
});
// 特殊源失败与无结果都返回空数组，空结果不缓存，避免一次失败在各实例间扩散
const SPECIAL_SOURCE_SEARCHES = createSharedServerCache<SearchResult[]>({
  name: 'special-search-v1',
  ...getServerCacheBudget('search-pages'),
  freshMs: SEARCH_CACHE_TTL_MS,
  staleMs: SEARCH_CACHE_STALE_MS,
  shouldCache: (results) => results.length > 0,
});
const SEARCH_AGGREGATE_LOAD_INFLIGHT: Map<
  string,
  Promise<CachedSearchAggregateEntry>
> = new Map();

const SEARCH_INFLIGHT: Map<string, Promise<SearchPageLoadResult>> = new Map();

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
  entry: CachedSearchAggregateEntry,
): void {
  if (entry.results.length === 0) return;

  const key = makeSearchAggregateCacheKey(params);
  SEARCH_AGGREGATE_CACHE.set(key, entry);
}

// 只重搜失败源后，用新结果替换这些源在已缓存聚合中的部分；没有缓存时不凭局部结果新建
export function mergeRetriedSearchAggregate(
  params: SearchAggregateCacheParams,
  retriedSources: ReadonlySet<string>,
  retried: CachedSearchAggregateEntry,
): void {
  const cached = peekCachedSearchAggregate(params);
  if (!cached) return;

  setCachedSearchAggregate(params, {
    results: cached.entry.results
      .filter((item) => !retriedSources.has(item.source))
      .concat(retried.results),
    failedSources: (cached.entry.failedSources ?? [])
      .filter((key) => !retriedSources.has(key))
      .concat(retried.failedSources ?? []),
  });
}

export function refreshCachedSearchAggregate(
  params: SearchAggregateCacheParams,
  loader: () => Promise<CachedSearchAggregateEntry>,
): Promise<void> {
  const key = makeSearchAggregateCacheKey(params);
  const existing = SEARCH_AGGREGATE_REFRESH_INFLIGHT.get(key);
  if (existing) return existing;

  const task = SEARCH_AGGREGATE_CACHE.refresh(key, async () => {
    const entry = await loader();
    setCachedSearchAggregate(params, entry);
    return entry;
  }).finally(() => {
    SEARCH_AGGREGATE_REFRESH_INFLIGHT.delete(key);
  });

  SEARCH_AGGREGATE_REFRESH_INFLIGHT.set(key, task);
  return task;
}

export function loadCachedSearchAggregate(
  params: SearchAggregateCacheParams,
  loader: () => Promise<CachedSearchAggregateEntry>,
): Promise<CachedSearchAggregateEntry> {
  const key = makeSearchAggregateCacheKey(params);
  const existing = SEARCH_AGGREGATE_LOAD_INFLIGHT.get(key);
  if (existing) return existing;

  const task = SEARCH_AGGREGATE_CACHE.getOrLoad(key, async () => {
    const entry = await loader();
    setCachedSearchAggregate(params, entry);
    return entry;
  }).finally(() => {
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
  loader: () => Promise<SearchPageLoadResult>,
): Promise<SearchPageLoadResult> {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const existing = SEARCH_INFLIGHT.get(key);
  if (existing) return existing;
  const p = SHARED_SEARCH_PAGES.getOrLoad(key, loader).finally(() => {
    SEARCH_INFLIGHT.delete(key);
  });
  SEARCH_INFLIGHT.set(key, p);
  return p;
}

export function loadSpecialSourceSearch(
  sourceKey: string,
  query: string,
  loader: () => Promise<SearchResult[]>,
): Promise<SearchResult[]> {
  return SPECIAL_SOURCE_SEARCHES.getOrLoad(
    makeSearchCacheKey(sourceKey, query, 1),
    loader,
  );
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
    specialSources: SPECIAL_SOURCE_SEARCHES.stats(),
  };
}

export function clearSearchCachesForTests(): void {
  SEARCH_CACHE.clear();
  SEARCH_EMPTY_CACHE.clear();
  SEARCH_AGGREGATE_CACHE.clear();
  SHARED_SEARCH_PAGES.clear();
  SPECIAL_SOURCE_SEARCHES.clear();
  SEARCH_INFLIGHT.clear();
  SEARCH_AGGREGATE_REFRESH_INFLIGHT.clear();
  SEARCH_AGGREGATE_LOAD_INFLIGHT.clear();
}
