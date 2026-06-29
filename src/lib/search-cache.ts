import type { ApiSite } from '@/lib/config';
import { SearchResult } from '@/lib/types';

// 缓存状态类型
export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

// 缓存条目接口
export interface CachedPageEntry {
  expiresAt: number;
  // 软过期截止：expiresAt~staleUntil 之间命中返回旧值并触发后台刷新
  staleUntil: number;
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number; // 仅第一页可选存储
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

// 缓存配置
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟 新鲜期
const SEARCH_CACHE_STALE_MS = 10 * 60 * 1000; // 10分钟 软过期窗口
const SEARCH_AGGREGATE_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_AGGREGATE_CACHE_STALE_MS = 3 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分钟清理一次
const MAX_CACHE_SIZE = 1000; // 最大缓存条目数量
const MAX_AGGREGATE_CACHE_SIZE = 200;
const SEARCH_CACHE: Map<string, CachedPageEntry> = new Map();
const SEARCH_AGGREGATE_CACHE: Map<string, CachedSearchAggregateEntry> =
  new Map();
const SEARCH_AGGREGATE_REFRESH_INFLIGHT: Map<string, Promise<void>> = new Map();

// 正在进行的同 key 回源请求，抑制雷群
const SEARCH_INFLIGHT: Map<
  string,
  Promise<{ results: SearchResult[]; pageCount?: number }>
> = new Map();

// 自动清理定时器
let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

/**
 * 生成搜索缓存键：source + query + page
 */
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

/**
 * 读取缓存。返回值同时给出 fresh / stale 状态，调用方可据此决定是否后台刷新。
 * - fresh: 直接用
 * - stale: 可先返回，再触发后台刷新
 * - null: 完全未命中或已彻底过期
 */
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
  // 彻底过期
  SEARCH_CACHE.delete(key);
  return null;
}

/**
 * 请求合并：同 key 的并发回源只执行一次 loader，其它调用复用同一个 Promise。
 * loader 内部应自行调用 setCachedSearchPage 写入缓存。
 */
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

/**
 * 获取缓存的搜索页面数据
 */
export function getCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
): CachedPageEntry | null {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;

  // 仅 fresh 才直接返回；stale/硬过期走 peekCachedSearchPage / dedupeSearchLoad
  if (entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry;
}

/**
 * 设置缓存的搜索页面数据
 */
export function setCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number,
): void {
  // 惰性启动自动清理
  ensureAutoCleanupStarted();

  // 惰性清理：每次写入时检查是否需要清理
  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  const key = makeSearchCacheKey(sourceKey, query, page);
  SEARCH_CACHE.set(key, {
    expiresAt: now + SEARCH_CACHE_TTL_MS,
    staleUntil: now + SEARCH_CACHE_TTL_MS + SEARCH_CACHE_STALE_MS,
    status,
    data,
    pageCount,
  });

  trimCacheByStaleUntil(SEARCH_CACHE, MAX_CACHE_SIZE);
}

/**
 * 确保自动清理已启动（惰性初始化）
 */
function ensureAutoCleanupStarted(): void {
  if (!cleanupTimer) {
    startAutoCleanup();
  }
}

/**
 * 智能清理过期的缓存条目
 */
function performCacheCleanup(): {
  expired: number;
  total: number;
  sizeLimited: number;
} {
  const now = Date.now();
  const keysToDelete: string[] = [];
  const aggregateKeysToDelete: string[] = [];
  let sizeLimitedDeleted = 0;

  // 1. 清理彻底过期条目（超出软过期窗口）
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

/**
 * 启动自动清理定时器
 */
function startAutoCleanup(): void {
  if (cleanupTimer) return; // 避免重复启动

  cleanupTimer = setInterval(() => {
    performCacheCleanup();
  }, CACHE_CLEANUP_INTERVAL_MS);

  // 在 Node.js 环境中避免阻止程序退出
  if (typeof process !== 'undefined' && cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}
