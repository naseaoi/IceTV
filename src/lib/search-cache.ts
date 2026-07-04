import type { ApiSite } from '@/lib/config';
import { SearchResult } from '@/lib/types';

export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

export interface CachedPageEntry {
  expiresAt: number;
  staleUntil: number;
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
  expiresAt: number;
  staleUntil: number;
  results: SearchResult[];
}

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_STALE_MS = 10 * 60 * 1000;
const SEARCH_EMPTY_CACHE_TTL_MS = 60 * 1000;
const SEARCH_EMPTY_CACHE_STALE_MS = 60 * 1000;
const SEARCH_AGGREGATE_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_AGGREGATE_CACHE_STALE_MS = 3 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;
const MAX_AGGREGATE_CACHE_SIZE = 200;
const SEARCH_CACHE: Map<string, CachedPageEntry> = new Map();
const SEARCH_AGGREGATE_CACHE: Map<string, CachedSearchAggregateEntry> =
  new Map();
const SEARCH_AGGREGATE_REFRESH_INFLIGHT: Map<string, Promise<void>> = new Map();
const SEARCH_AGGREGATE_LOAD_INFLIGHT: Map<
  string,
  Promise<SearchResult[]>
> = new Map();

const SEARCH_INFLIGHT: Map<
  string,
  Promise<{ results: SearchResult[]; pageCount?: number }>
> = new Map();

let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

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
  const entry = SEARCH_AGGREGATE_CACHE.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now < entry.expiresAt) return { entry, fresh: true };
  if (now < entry.staleUntil) return { entry, fresh: false };
  SEARCH_AGGREGATE_CACHE.delete(key);
  return null;
}

export function setCachedSearchAggregate(
  params: SearchAggregateCacheParams,
  results: SearchResult[],
): void {
  if (results.length === 0) return;

  ensureAutoCleanupStarted();

  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  const key = makeSearchAggregateCacheKey(params);
  SEARCH_AGGREGATE_CACHE.set(key, {
    expiresAt: now + SEARCH_AGGREGATE_CACHE_TTL_MS,
    staleUntil:
      now + SEARCH_AGGREGATE_CACHE_TTL_MS + SEARCH_AGGREGATE_CACHE_STALE_MS,
    results,
  });

  trimCacheByStaleUntil(SEARCH_AGGREGATE_CACHE, MAX_AGGREGATE_CACHE_SIZE);
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
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now < entry.expiresAt) return { entry, fresh: true };
  if (now < entry.staleUntil) return { entry, fresh: false };
  SEARCH_CACHE.delete(key);
  return null;
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
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry;
}

export function setCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number,
): void {
  ensureAutoCleanupStarted();

  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  const cacheWindow = getSearchPageCacheWindow(status, data);
  const key = makeSearchCacheKey(sourceKey, query, page);
  SEARCH_CACHE.set(key, {
    expiresAt: now + cacheWindow.ttlMs,
    staleUntil: now + cacheWindow.ttlMs + cacheWindow.staleMs,
    status,
    data,
    pageCount,
  });

  trimCacheByStaleUntil(SEARCH_CACHE, MAX_CACHE_SIZE);
}

function getSearchPageCacheWindow(
  status: CachedPageStatus,
  data: SearchResult[],
): { ttlMs: number; staleMs: number } {
  if (status === 'ok' && data.length === 0) {
    return {
      ttlMs: SEARCH_EMPTY_CACHE_TTL_MS,
      staleMs: SEARCH_EMPTY_CACHE_STALE_MS,
    };
  }

  return {
    ttlMs: SEARCH_CACHE_TTL_MS,
    staleMs: SEARCH_CACHE_STALE_MS,
  };
}

function ensureAutoCleanupStarted(): void {
  if (!cleanupTimer) {
    startAutoCleanup();
  }
}

function performCacheCleanup(): {
  expired: number;
  total: number;
  sizeLimited: number;
} {
  const now = Date.now();
  const keysToDelete: string[] = [];
  const aggregateKeysToDelete: string[] = [];
  let sizeLimitedDeleted = 0;

  SEARCH_CACHE.forEach((entry, key) => {
    if (entry.staleUntil <= now) {
      keysToDelete.push(key);
    }
  });
  SEARCH_AGGREGATE_CACHE.forEach((entry, key) => {
    if (entry.staleUntil <= now) {
      aggregateKeysToDelete.push(key);
    }
  });

  const expiredCount = keysToDelete.length;
  keysToDelete.forEach((key) => SEARCH_CACHE.delete(key));
  aggregateKeysToDelete.forEach((key) => SEARCH_AGGREGATE_CACHE.delete(key));

  sizeLimitedDeleted += trimCacheByStaleUntil(SEARCH_CACHE, MAX_CACHE_SIZE);
  sizeLimitedDeleted += trimCacheByStaleUntil(
    SEARCH_AGGREGATE_CACHE,
    MAX_AGGREGATE_CACHE_SIZE,
  );

  lastCleanupTime = now;

  return {
    expired: expiredCount,
    total: SEARCH_CACHE.size,
    sizeLimited: sizeLimitedDeleted,
  };
}

function trimCacheByStaleUntil<T extends { staleUntil: number }>(
  cache: Map<string, T>,
  maxSize: number,
): number {
  if (cache.size <= maxSize) return 0;

  const entries = Array.from(cache.entries());
  entries.sort((a, b) => a[1].staleUntil - b[1].staleUntil);

  const toRemove = cache.size - maxSize;
  for (let i = 0; i < toRemove; i++) {
    cache.delete(entries[i][0]);
  }

  return toRemove;
}

function startAutoCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    performCacheCleanup();
  }, CACHE_CLEANUP_INTERVAL_MS);

  if (typeof process !== 'undefined' && cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}
