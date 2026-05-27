/**
 * db.client.ts 的内部基础设施：
 * - 存储/网络工具函数
 * - HybridCacheManager
 * - 两个泛型工厂函数（createCacheFirstReader / createOptimisticWriter）
 *
 * 该文件不包含 'use client' 指令，由 db.client.ts 统一声明。
 */

import { getAuthInfoFromBrowserCookie } from './auth';
import type { SkipConfig } from './types';
import type { PlayRecord, Favorite, CacheUpdateEvent } from './db.client';

// ================================================================
// 会话探针 & 认证恢复
// ================================================================

type SessionProbeResult = {
  authenticated: boolean;
  reason:
    | 'ok'
    | 'missing_cookie'
    | 'session_expired'
    | 'invalid_signature'
    | 'missing_signature'
    | 'missing_username'
    | 'user_not_found'
    | 'user_banned'
    | 'server_error';
  username?: string | null;
};

type SessionLostDetail = {
  reason: SessionProbeResult['reason'];
  sourceUrl: string;
  loginUrl: string;
  inPlayerPage: boolean;
};

export type ClientRequestErrorKind =
  | 'network'
  | 'request_aborted'
  | 'http'
  | 'auth_rejected'
  | 'session_lost';

type ClientRequestErrorOptions = {
  kind: ClientRequestErrorKind;
  url: string;
  method: string;
  status?: number;
  sessionReason?: SessionProbeResult['reason'];
  cause?: unknown;
};

export class ClientRequestError extends Error {
  readonly kind: ClientRequestErrorKind;
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  readonly sessionReason?: SessionProbeResult['reason'];
  readonly cause?: unknown;

  constructor(options: ClientRequestErrorOptions) {
    const { kind, url, method, status, sessionReason, cause } = options;
    const detail = status ? ` (${status})` : '';
    super(`[${method}] ${url} 请求失败${detail}: ${kind}`);
    this.name = 'ClientRequestError';
    this.kind = kind;
    this.url = url;
    this.method = method;
    this.status = status;
    this.sessionReason = sessionReason;
    this.cause = cause;
  }
}

export function isClientRequestError(
  error: unknown,
): error is ClientRequestError {
  return error instanceof ClientRequestError;
}

let authLossHandling = false;

const AUTH_SOFT_RECOVERY_EVENT = 'auth:session-lost';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestMethod(options?: RequestInit): string {
  return (options?.method || 'GET').toUpperCase();
}

function createHttpRequestError(
  url: string,
  method: string,
  status: number,
): ClientRequestError {
  return new ClientRequestError({
    kind: 'http',
    url,
    method,
    status,
  });
}

async function requestOnce(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const method = getRequestMethod(options);

  try {
    return await fetch(url, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ClientRequestError({
        kind: 'request_aborted',
        url,
        method,
        cause: error,
      });
    }

    throw new ClientRequestError({
      kind: 'network',
      url,
      method,
      cause: error,
    });
  }
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isRetryableClientRequestError(error: unknown): boolean {
  if (!isClientRequestError(error)) {
    return false;
  }

  if (error.kind === 'network' || error.kind === 'request_aborted') {
    return true;
  }

  if (error.kind === 'auth_rejected') {
    return true;
  }

  if (error.kind === 'http' && error.status) {
    return isTransientHttpStatus(error.status);
  }

  return false;
}

export async function retryClientRequest<T>(
  task: () => Promise<T>,
  options?: {
    retries?: number;
    delayMs?: number;
  },
): Promise<T> {
  const retries = Math.max(0, options?.retries ?? 0);
  const delayMs = Math.max(0, options?.delayMs ?? 400);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= retries || !isRetryableClientRequestError(error)) {
        throw error;
      }

      // 网络抖动和服务端短暂异常时，延迟后再尝试一次。
      await wait(delayMs * (attempt + 1));
    }
  }
}

async function probeSession(): Promise<SessionProbeResult> {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 401) {
        return {
          authenticated: false,
          reason: 'missing_cookie',
          username: null,
        };
      }
      return {
        authenticated: false,
        reason: 'server_error',
        username: null,
      };
    }

    return (await res.json()) as SessionProbeResult;
  } catch (error) {
    console.error('会话探针请求失败:', error);
    return {
      authenticated: false,
      reason: 'server_error',
      username: null,
    };
  }
}

function buildLoginUrl(): string {
  const currentUrl = window.location.pathname + window.location.search;
  const loginUrl = new URL('/login', window.location.origin);
  loginUrl.searchParams.set('redirect', currentUrl);
  return loginUrl.toString();
}

function notifySessionLost(
  reason: SessionProbeResult['reason'],
  sourceUrl: string,
) {
  if (authLossHandling) {
    return;
  }

  authLossHandling = true;
  const loginUrl = buildLoginUrl();
  const inPlayerPage = window.location.pathname.startsWith('/play');
  const inHomePage = window.location.pathname === '/';

  window.dispatchEvent(
    new CustomEvent<SessionLostDetail>(AUTH_SOFT_RECOVERY_EVENT, {
      detail: {
        reason,
        sourceUrl,
        loginUrl,
        inPlayerPage,
      },
    }),
  );

  // 首页和播放页不自动跳转登录，避免中断浏览体验
  if (!inPlayerPage && !inHomePage) {
    window.location.href = loginUrl;
  }
}

function resetAuthLossHandlingFlag() {
  setTimeout(() => {
    authLossHandling = false;
  }, 3000);
}

// ================================================================
// 全局错误触发
// ================================================================

export function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      }),
    );
  }
}

// ================================================================
// localStorage 工具
// ================================================================

export function getStorageValueWithLegacy(
  key: string,
  legacyKey?: string,
): string | null {
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    return raw;
  }
  if (!legacyKey) {
    return null;
  }
  const legacyRaw = localStorage.getItem(legacyKey);
  if (legacyRaw !== null) {
    localStorage.setItem(key, legacyRaw);
  }
  return legacyRaw;
}

export function setStorageValueWithLegacyCleanup(
  key: string,
  value: string,
  legacyKey?: string,
): void {
  localStorage.setItem(key, value);
  if (legacyKey) {
    localStorage.removeItem(legacyKey);
  }
}

// ================================================================
// fetch 工具
// ================================================================

export async function fetchWithAuth(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const method = getRequestMethod(options);
  const initialRes = await requestOnce(url, options);

  if (initialRes.ok) {
    return initialRes;
  }

  if (initialRes.status !== 401 && initialRes.status !== 403) {
    throw createHttpRequestError(url, method, initialRes.status);
  }

  let authFailureRes = initialRes;

  if (initialRes.status === 401) {
    await wait(500);
    const retryRes = await requestOnce(url, options);
    if (retryRes.ok) {
      return retryRes;
    }

    if (retryRes.status !== 401 && retryRes.status !== 403) {
      throw createHttpRequestError(url, method, retryRes.status);
    }

    authFailureRes = retryRes;
  }

  const session = await probeSession();

  if (session.authenticated) {
    triggerGlobalError('请求暂时失败，已自动重试，请稍后继续操作');
    throw new ClientRequestError({
      kind: 'auth_rejected',
      url,
      method,
      status: authFailureRes.status,
      sessionReason: session.reason,
    });
  }

  if (session.reason === 'user_banned') {
    triggerGlobalError('账号已被封禁，请联系管理员');
  } else if (session.reason === 'user_not_found') {
    triggerGlobalError('账号不存在，请重新登录');
  } else {
    triggerGlobalError('登录状态已失效，请重新登录');
  }

  notifySessionLost(session.reason, url);
  resetAuthLossHandlingFlag();
  throw new ClientRequestError({
    kind: 'session_lost',
    url,
    method,
    status: authFailureRes.status,
    sessionReason: session.reason,
  });
}

export async function fetchFromApi<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  return (await res.json()) as T;
}

// ================================================================
// HybridCacheManager
// ================================================================

interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
}

const CACHE_PREFIX = 'icetv_cache_';
const LEGACY_CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; // 一小时缓存过期

export class HybridCacheManager {
  private static instance: HybridCacheManager;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};

    try {
      const cacheKey = this.getUserCacheKey(username);
      const legacyCacheKey = cacheKey.replace(
        CACHE_PREFIX,
        LEGACY_CACHE_PREFIX,
      );
      const cached = getStorageValueWithLegacy(cacheKey, legacyCacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('获取用户缓存失败:', error);
      return {};
    }
  }

  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;

    try {
      const cacheSize = JSON.stringify(cache).length;
      if (cacheSize > 15 * 1024 * 1024) {
        console.warn('缓存过大，清理旧数据');
        this.cleanOldCache(cache);
      }

      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('保存用户缓存失败:', error);
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.clearAllCache();
        try {
          const cacheKey = this.getUserCacheKey(username);
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch (retryError) {
          console.error('重试保存缓存仍然失败:', retryError);
        }
      }
    }
  }

  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000; // 两个月

    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }
  }

  private clearAllCache(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  }

  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  // ---- 泛型缓存读写 ----

  /** 读取指定类型的缓存数据，过期或不存在返回 null */
  getCached<K extends keyof UserCacheStore>(
    key: K,
  ): NonNullable<UserCacheStore[K]>['data'] | null {
    const username = this.getCurrentUsername();
    if (!username) return null;
    const userCache = this.getUserCache(username);
    const cached = userCache[key];
    if (cached && this.isCacheValid(cached as CacheData<unknown>))
      return cached.data as NonNullable<UserCacheStore[K]>['data'];
    return null;
  }

  /** 写入指定类型的缓存数据 */
  cache<K extends keyof UserCacheStore>(
    key: K,
    data: NonNullable<UserCacheStore[K]>['data'],
  ): void {
    const username = this.getCurrentUsername();
    if (!username) return;
    const userCache = this.getUserCache(username);
    (userCache[key] as CacheData<unknown>) = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  // ---- 向后兼容的便捷方法（委托给泛型方法）----

  getCachedPlayRecords() {
    return this.getCached('playRecords');
  }
  cachePlayRecords(data: Record<string, PlayRecord>) {
    this.cache('playRecords', data);
  }

  getCachedFavorites() {
    return this.getCached('favorites');
  }
  cacheFavorites(data: Record<string, Favorite>) {
    this.cache('favorites', data);
  }

  getCachedSearchHistory() {
    return this.getCached('searchHistory');
  }
  cacheSearchHistory(data: string[]) {
    this.cache('searchHistory', data);
  }

  getCachedSkipConfigs() {
    return this.getCached('skipConfigs');
  }
  cacheSkipConfigs(data: Record<string, SkipConfig>) {
    this.cache('skipConfigs', data);
  }

  // ---- 缓存管理 ----
  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;
    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('清除用户缓存失败:', error);
    }
  }

  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            let hasValidData = false;
            for (const [, cacheData] of Object.entries(cache)) {
              if (
                cacheData &&
                this.isCacheValid(cacheData as CacheData<unknown>)
              ) {
                hasValidData = true;
                break;
              }
            }
            if (!hasValidData) {
              keysToRemove.push(key);
            }
          } catch {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('清除过期缓存失败:', error);
    }
  }
}

export const cacheManager = HybridCacheManager.getInstance();

// 页面加载时清理过期缓存
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

// ================================================================
// 错误处理辅助
// ================================================================

export async function handleDatabaseOperationFailure(
  dataType: 'playRecords' | 'favorites' | 'searchHistory',
  error: unknown,
): Promise<void> {
  console.error(`数据库操作失败 (${dataType}):`, error);

  const message = getDatabaseOperationFailureMessage(dataType, error);
  if (message) {
    triggerGlobalError(message);
  }

  if (!shouldRefreshDatabaseCache(dataType, error)) {
    return;
  }

  try {
    let freshData: unknown;
    let eventName: string;

    switch (dataType) {
      case 'playRecords':
        freshData =
          await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
        cacheManager.cachePlayRecords(freshData as Record<string, PlayRecord>);
        eventName = 'playRecordsUpdated';
        break;
      case 'favorites':
        freshData =
          await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
        cacheManager.cacheFavorites(freshData as Record<string, Favorite>);
        eventName = 'favoritesUpdated';
        break;
      case 'searchHistory':
        freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        cacheManager.cacheSearchHistory(freshData as string[]);
        eventName = 'searchHistoryUpdated';
        break;
    }

    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: freshData,
      }),
    );
  } catch (refreshErr) {
    console.error(`刷新${dataType}缓存失败:`, refreshErr);
    triggerGlobalError(`刷新${dataType}缓存失败`);
  }
}

function getDatabaseOperationFailureMessage(
  dataType: 'playRecords' | 'favorites' | 'searchHistory',
  error: unknown,
): string | null {
  if (isClientRequestError(error)) {
    if (error.kind === 'session_lost' || error.kind === 'auth_rejected') {
      return null;
    }

    if (dataType === 'playRecords') {
      if (error.kind === 'network' || error.kind === 'request_aborted') {
        return '播放进度暂时保存失败，当前进度已保留，稍后会继续尝试';
      }

      if (error.kind === 'http' && error.status) {
        if (isTransientHttpStatus(error.status)) {
          return '播放进度暂时保存失败，服务稍后恢复后会继续尝试';
        }

        return '播放进度保存请求无效，请刷新页面后重试';
      }
    }

    if (error.kind === 'network' || error.kind === 'request_aborted') {
      return '数据同步失败，网络恢复后请重试';
    }

    if (error.kind === 'http' && error.status) {
      if (isTransientHttpStatus(error.status)) {
        return '数据同步失败，服务暂时不可用，请稍后重试';
      }

      return '数据同步失败，请刷新页面后重试';
    }
  }

  return '数据库操作失败';
}

function shouldRefreshDatabaseCache(
  dataType: 'playRecords' | 'favorites' | 'searchHistory',
  error: unknown,
): boolean {
  if (isClientRequestError(error)) {
    if (
      error.kind === 'session_lost' ||
      error.kind === 'auth_rejected' ||
      error.kind === 'network' ||
      error.kind === 'request_aborted'
    ) {
      return false;
    }

    if (error.kind === 'http' && error.status) {
      if (isTransientHttpStatus(error.status)) {
        return false;
      }

      // 播放进度保存时保留乐观缓存，避免被旧服务端数据回滚。
      if (dataType === 'playRecords') {
        return false;
      }
    }
  }

  return true;
}

// ================================================================
// 泛型工厂函数
// ================================================================

/**
 * 模式A：缓存优先+后台同步（读操作）
 *
 * 流程：
 * 1. SSR 环境 → 返回 fallback
 * 2. 未认证 → 返回缓存（如有）或 fallback，不触发 API 请求
 * 3. 已认证 localdb 模式：
 *    a. 有缓存 → 返回缓存，后台 fetchApi，有差异则更新缓存+dispatch
 *    b. 无缓存 → await fetchApi → 缓存 → 返回
 */
export function createCacheFirstReader<T>(options: {
  getCached: () => T | null;
  setCached: (data: T) => void;
  fetchApi: () => Promise<T>;
  eventName: CacheUpdateEvent;
  fallback: T;
  /** 可选：自定义后台同步失败时是否调用 triggerGlobalError，默认 true */
  bgSyncErrorNotify?: boolean;
}): () => Promise<T> {
  const {
    getCached,
    setCached,
    fetchApi,
    eventName,
    fallback,
    bgSyncErrorNotify = true,
  } = options;

  return async (): Promise<T> => {
    if (typeof window === 'undefined') {
      return fallback;
    }

    // 未认证用户：仅返回缓存或空数据，不发起 API 请求（避免 401 → 重定向循环）
    const authInfo = getAuthInfoFromBrowserCookie();
    if (!authInfo?.username) {
      return getCached() ?? fallback;
    }

    const cachedData = getCached();

    if (cachedData) {
      // 后台异步同步
      fetchApi()
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            setCached(freshData);
            window.dispatchEvent(
              new CustomEvent(eventName, { detail: freshData }),
            );
          }
        })
        .catch((err) => {
          console.warn(`后台同步${eventName}失败:`, err);
          if (bgSyncErrorNotify) {
            triggerGlobalError(`后台同步${eventName}失败`);
          }
        });

      return cachedData;
    }

    try {
      const freshData = await fetchApi();
      setCached(freshData);
      return freshData;
    } catch (err) {
      console.error(`获取${eventName}失败:`, err);
      triggerGlobalError(`获取${eventName}失败`);
      return fallback;
    }
  };
}

/**
 * 模式B：乐观更新（写/删操作）
 *
 * 流程：
 * 1. 未认证 → 抛出错误，阻止写操作
 * 2. 已认证 localdb 模式：
 *    a. 读缓存 → mutateCached → 写回缓存 → dispatch → syncToServer
 *    b. 失败时由调用方决定是否 handleDatabaseOperationFailure
 */
export function createOptimisticWriter<TCache>(options: {
  getCached: () => TCache | null;
  setCached: (data: TCache) => void;
  eventName: CacheUpdateEvent;
  emptyCacheFactory: () => TCache;
}): (mutation: {
  mutateCached: (cached: TCache) => TCache;
  mutateLocal: (stored: TCache) => TCache;
  syncToServer: () => Promise<void>;
  eventDetail?: unknown;
  onServerError?: (err: unknown) => Promise<void>;
}) => Promise<void> {
  const { getCached, setCached, eventName, emptyCacheFactory } = options;

  return async (mutation): Promise<void> => {
    const { mutateCached, syncToServer, eventDetail, onServerError } = mutation;

    const cached = getCached() || emptyCacheFactory();
    const updated = mutateCached(cached);
    setCached(updated);

    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: eventDetail !== undefined ? eventDetail : updated,
      }),
    );

    try {
      await syncToServer();
    } catch (err) {
      if (onServerError) {
        await onServerError(err);
      }
      throw err;
    }
  };
}
