/**
 * db.client.ts 的内部基础设施：
 * - 存储/网络工具函数
 * - HybridCacheManager
 * - 两个泛型工厂函数（createCacheFirstReader / createOptimisticWriter）
 *
 * 该文件不包含 'use client' 指令，由 db.client.ts 统一声明。
 */

import {
  AUTH_SESSION_LOST_EVENT,
  getAuthInfoFromBrowserCookie,
} from './auth.client';
import type { CacheUpdateEvent } from './db.client';
import { showToast } from './toast';
import { getErrorMessage, isAbortError } from './user-facing-error';

export { cacheManager } from './db.client.cache';

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

type ClientRequestErrorKind =
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

class ClientRequestError extends Error {
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

function isClientRequestError(error: unknown): error is ClientRequestError {
  return error instanceof ClientRequestError;
}

let authLossHandling = false;

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

function isRetryableClientRequestError(error: unknown): boolean {
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

  window.dispatchEvent(
    new CustomEvent<SessionLostDetail>(AUTH_SESSION_LOST_EVENT, {
      detail: {
        reason,
        sourceUrl,
        loginUrl,
        inPlayerPage,
      },
    }),
  );
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
  showToast(message, 'error');
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

export async function fetchFromApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(path, options);
  return (await res.json()) as T;
}

// ================================================================
// 错误处理辅助
// ================================================================

export async function handleDatabaseOperationFailure(
  dataType: 'playRecords' | 'favorites' | 'searchHistory',
  error: unknown,
  failureMessage?: string,
): Promise<void> {
  console.error(`数据库操作失败 (${dataType}):`, error);

  const message = getDatabaseOperationFailureMessage(
    dataType,
    error,
    failureMessage,
  );
  if (message) {
    triggerGlobalError(message);
  }
}

// 播放页读取记录持续失败时，保存处于阻断状态，不会触发保存失败提示；登录失效交给统一会话处理
export function reportPlaybackRecordsReadFailure(error: unknown): void {
  if (
    isClientRequestError(error) &&
    (error.kind === 'session_lost' || error.kind === 'auth_rejected')
  ) {
    return;
  }
  triggerGlobalError('播放进度暂时无法同步，服务恢复后会回到上次看到的位置');
}

function getDatabaseOperationFailureMessage(
  dataType: 'playRecords' | 'favorites' | 'searchHistory',
  error: unknown,
  failureMessage?: string,
): string | null {
  if (
    isClientRequestError(error) &&
    (error.kind === 'session_lost' || error.kind === 'auth_rejected')
  ) {
    return null;
  }
  if (isAbortError(error)) return null;
  if (failureMessage) return failureMessage;

  if (isClientRequestError(error)) {
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

  return getErrorMessage(error, '操作未能完成，请稍后重试');
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
let readerUsername: string | null = null;
let readerGeneration = 0;
const readFlights = new Map<string, Promise<unknown>>();
const writeRevisions = new Map<CacheUpdateEvent, number>();

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_SESSION_LOST_EVENT, () => {
    readerUsername = null;
    readerGeneration += 1;
    readFlights.clear();
  });
}

function getReaderScope(): string {
  const username = getAuthInfoFromBrowserCookie()?.username ?? null;
  if (username !== readerUsername) {
    readerUsername = username;
    readerGeneration += 1;
    readFlights.clear();
  }
  return `${readerGeneration}:${username ?? ''}`;
}

function mergeReadFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = readFlights.get(key);
  if (pending) return pending as Promise<T>;
  const request = load().finally(() => {
    if (readFlights.get(key) === request) readFlights.delete(key);
  });
  readFlights.set(key, request);
  return request;
}

export function createKeyedNetworkReader<T>(options: {
  getCached: () => Record<string, T> | null;
  setCached: (data: Record<string, T>) => void;
  fetchApi: (keys: string[], signal: AbortSignal) => Promise<Record<string, T>>;
  eventName: CacheUpdateEvent;
}): (
  keys: string[],
  options?: { timeoutMs?: number },
) => {
  cached: Record<string, T> | null;
  fresh: Promise<Record<string, T>>;
} {
  return (requestedKeys, readOptions) => {
    const keys = [...new Set(requestedKeys)].sort();
    if (typeof window === 'undefined' || !keys.length)
      return { cached: null, fresh: Promise.resolve({}) };
    const scope = getReaderScope();
    if (!getAuthInfoFromBrowserCookie()?.username)
      return { cached: null, fresh: Promise.resolve({}) };

    const { getCached, setCached, fetchApi, eventName } = options;
    const select = (data: Record<string, T> | null) =>
      Object.fromEntries(
        keys
          .filter((key) => data?.[key] !== undefined)
          .map((key) => [key, data![key]]),
      );
    const cached = getCached();
    const baseline = JSON.stringify(select(cached));
    const revision = writeRevisions.get(eventName);
    const timeoutMs = readOptions?.timeoutMs ?? 8000;
    // 独立命名空间避免复用旧 reader 吞掉错误的请求；超时不同的调用独立计时。
    const fresh = mergeReadFlight(
      `${scope}:${eventName}:network:${timeoutMs}:${JSON.stringify(keys)}`,
      async () => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new DOMException(
              'Playback records read timed out',
              'TimeoutError',
            );
            reject(error);
            controller.abort(error);
          }, timeoutMs);
        });
        try {
          const result = await Promise.race([
            fetchApi(keys, controller.signal),
            timeout,
          ]);
          if (getReaderScope() !== scope) return {};
          const current = getCached();
          if (
            writeRevisions.get(eventName) !== revision ||
            JSON.stringify(select(current)) !== baseline
          )
            return select(current);
          if (current) {
            const merged = { ...current };
            for (const key of keys) {
              if (result[key] !== undefined) merged[key] = result[key];
              else delete merged[key];
            }
            setCached(merged);
            window.dispatchEvent(
              new CustomEvent(eventName, { detail: merged }),
            );
          }
          return result;
        } catch (error) {
          if (getReaderScope() !== scope) return {};
          throw error;
        } finally {
          clearTimeout(timer);
        }
      },
    );
    return { cached: cached === null ? null : select(cached), fresh };
  };
}

// 定向结果只合并已有快照，避免把部分条目冒充全账户缓存。
export function createKeyedCacheFirstReader<T>(options: {
  getCached: () => Record<string, T> | null;
  setCached: (data: Record<string, T>) => void;
  fetchApi: (keys: string[]) => Promise<Record<string, T>>;
  eventName: CacheUpdateEvent;
}): (keys: string[]) => Promise<Record<string, T>> {
  return async (requestedKeys) => {
    const keys = [...new Set(requestedKeys)].sort();
    if (typeof window === 'undefined' || !keys.length) return {};
    const scope = getReaderScope();
    if (!getAuthInfoFromBrowserCookie()?.username) return {};
    const { getCached, setCached, fetchApi, eventName } = options;
    const select = (data: Record<string, T> | null) =>
      Object.fromEntries(
        keys
          .filter((key) => data?.[key] !== undefined)
          .map((key) => [key, data![key]]),
      );
    const cached = getCached();
    const baseline = JSON.stringify(select(cached));
    const revision = writeRevisions.get(eventName);
    // 缓存只由全量读取建立，快照缺键即视为无记录，立即返回并后台核对。
    const hasCached = cached !== null;
    const request = mergeReadFlight(
      `${scope}:${eventName}:${JSON.stringify(keys)}`,
      async () => {
        try {
          const fresh = await fetchApi(keys);
          if (getReaderScope() !== scope) return {};
          const current = getCached();
          if (
            writeRevisions.get(eventName) !== revision ||
            JSON.stringify(select(current)) !== baseline
          )
            return select(current);
          if (current) {
            const merged = { ...current };
            for (const key of keys) {
              if (fresh[key] !== undefined) merged[key] = fresh[key];
              else delete merged[key];
            }
            setCached(merged);
            window.dispatchEvent(
              new CustomEvent(eventName, { detail: merged }),
            );
          }
          return fresh;
        } catch (error) {
          if (getReaderScope() !== scope) return {};
          if (hasCached) console.warn(`后台同步${eventName}失败:`, error);
          else console.error(`读取${eventName}失败:`, error);
          if (
            !hasCached &&
            !isAbortError(error) &&
            !(
              isClientRequestError(error) &&
              ['session_lost', 'auth_rejected'].includes(error.kind)
            )
          )
            triggerGlobalError('加载失败，请稍后重试');
          return select(getCached());
        }
      },
    );
    return hasCached ? select(cached) : request;
  };
}

export function createCacheFirstReader<T>(options: {
  getCached: () => T | null;
  setCached: (data: T) => void;
  fetchApi: () => Promise<T>;
  eventName: CacheUpdateEvent;
  fallback: T;
}): () => Promise<T> {
  const { getCached, setCached, fetchApi, eventName, fallback } = options;

  return async (): Promise<T> => {
    if (typeof window === 'undefined') {
      return fallback;
    }

    // 未认证用户：仅返回缓存或空数据，不发起 API 请求（避免 401 → 重定向循环）
    const scope = getReaderScope();
    const authInfo = getAuthInfoFromBrowserCookie();
    if (!authInfo?.username) {
      return getCached() ?? fallback;
    }

    const cachedData = getCached();
    const baseline = JSON.stringify(cachedData);
    const revision = writeRevisions.get(eventName);
    const request = mergeReadFlight(`${scope}:${eventName}:all`, async () => {
      try {
        const freshData = await fetchApi();
        if (getReaderScope() !== scope) return fallback;
        if (
          writeRevisions.get(eventName) !== revision ||
          JSON.stringify(getCached()) !== baseline
        )
          return getCached() ?? fallback;
        setCached(freshData);
        if (cachedData !== null && baseline !== JSON.stringify(freshData)) {
          window.dispatchEvent(
            new CustomEvent(eventName, { detail: freshData }),
          );
        }
        return freshData;
      } catch (err) {
        if (getReaderScope() !== scope) return fallback;
        console.warn(`读取${eventName}失败:`, err);
        if (
          cachedData === null &&
          !isAbortError(err) &&
          !(
            isClientRequestError(err) &&
            ['session_lost', 'auth_rejected'].includes(err.kind)
          )
        )
          triggerGlobalError(getErrorMessage(err, '加载失败，请稍后重试'));
        return getCached() ?? fallback;
      }
    });
    return cachedData ?? request;
  };
}

/**
 * 模式B：乐观更新（写/删操作）
 *
 * 流程：
 * 1. 未认证 → 抛出错误，阻止写操作
 * 2. 已认证 localdb 模式：
 *    a. 读缓存 → mutateCached → 写回缓存 → dispatch → syncToServer
 *    b. 主动操作失败按条目恢复；自动播放进度上报可保留最新值
 */
export function createOptimisticWriter<TCache>(options: {
  getCached: () => TCache | null;
  setCached: (data: TCache) => void;
  eventName: CacheUpdateEvent;
  emptyCacheFactory: () => TCache;
}): (mutation: {
  mutateCached: (cached: TCache) => TCache;
  syncToServer: () => Promise<void>;
  eventDetail?: unknown;
  onServerError?: (err: unknown) => Promise<void>;
  requireExistingCacheForOptimisticUpdate?: boolean;
  affectedKeys?: string[] | 'all';
  rollbackOnError?: boolean;
}) => Promise<void> {
  const { getCached, setCached, eventName, emptyCacheFactory } = options;

  const owners = new Map<string, symbol>();

  return async (mutation): Promise<void> => {
    const {
      mutateCached,
      syncToServer,
      eventDetail,
      onServerError,
      requireExistingCacheForOptimisticUpdate = false,
      rollbackOnError = true,
    } = mutation;

    const scope = getReaderScope();
    writeRevisions.set(eventName, (writeRevisions.get(eventName) ?? 0) + 1);
    const cached = getCached();
    const token = Symbol();
    let rollback: (() => void) | undefined;
    if (cached !== null || !requireExistingCacheForOptimisticUpdate) {
      const before = cached ?? emptyCacheFactory();
      const updated = mutateCached(
        JSON.parse(JSON.stringify(before)) as TCache,
      );
      const entries = (value: TCache): Map<string, unknown> =>
        Array.isArray(value)
          ? new Map(value.map((key: string) => [key, key]))
          : new Map(Object.entries(value as Record<string, unknown>));
      const oldEntries = entries(before);
      const nextEntries = entries(updated);
      const keys =
        mutation.affectedKeys === 'all'
          ? [...new Set([...oldEntries.keys(), ...owners.keys()])]
          : (mutation.affectedKeys ??
            [...new Set([...oldEntries.keys(), ...nextEntries.keys()])].filter(
              (key) =>
                JSON.stringify(oldEntries.get(key)) !==
                JSON.stringify(nextEntries.get(key)),
            ));
      keys.forEach((key) => owners.set(key, token));
      setCached(updated);
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: eventDetail !== undefined ? eventDetail : updated,
        }),
      );
      rollback = () => {
        if (getReaderScope() !== scope) return;
        const current = getCached();
        if (current === null) return;
        const currentEntries = entries(current);
        const restored = JSON.parse(JSON.stringify(current)) as TCache;
        for (const key of keys) {
          // 同键后续写入拥有自己的令牌；回读或其他缓存写入还需按值检查。
          if (
            owners.get(key) !== token ||
            JSON.stringify(currentEntries.get(key)) !==
              JSON.stringify(nextEntries.get(key))
          )
            continue;
          if (Array.isArray(restored)) {
            const index = restored.indexOf(key);
            if (index !== -1) restored.splice(index, 1);
            if (oldEntries.has(key))
              restored.splice(
                Math.min((before as string[]).indexOf(key), restored.length),
                0,
                key,
              );
          } else {
            const record = restored as Record<string, unknown>;
            if (oldEntries.has(key)) record[key] = oldEntries.get(key);
            else delete record[key];
          }
        }
        setCached(restored);
        window.dispatchEvent(new CustomEvent(eventName, { detail: restored }));
      };
    }

    try {
      await syncToServer();
    } catch (err) {
      if (rollbackOnError) rollback?.();
      if (onServerError) {
        await onServerError(err);
      }
      throw err;
    } finally {
      for (const [key, owner] of owners) {
        if (owner === token) owners.delete(key);
      }
      if (
        eventName === 'favoritesUpdated' ||
        eventName === 'playRecordsUpdated'
      ) {
        window.dispatchEvent(new Event('userLibraryUpdated'));
      }
    }
  };
}
