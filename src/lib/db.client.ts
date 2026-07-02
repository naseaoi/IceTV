'use client';

import { getAuthInfoFromBrowserCookie } from './auth.client';
import type { Favorite, PlayRecord, SkipConfig } from './types';

import {
  cacheManager,
  fetchFromApi,
  fetchWithAuth,
  handleDatabaseOperationFailure,
  retryClientRequest,
  triggerGlobalError,
  createCacheFirstReader,
  createOptimisticWriter,
} from './db.client.internal';

export type { Favorite, PlayRecord, SkipConfig } from './types';

// 搜索历史最大保存条数
const SEARCH_HISTORY_LIMIT = 20;

/**
 * 生成存储key
 */
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// ================================================================
// 模式A工厂实例：缓存优先+后台同步（读操作）
// ================================================================

const _getAllPlayRecords = createCacheFirstReader<Record<string, PlayRecord>>({
  getCached: () => cacheManager.getCachedPlayRecords(),
  setCached: (data) => cacheManager.cachePlayRecords(data),
  fetchApi: () => fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`),
  eventName: 'playRecordsUpdated',
  fallback: {},
});

const _getSearchHistory = createCacheFirstReader<string[]>({
  getCached: () => cacheManager.getCachedSearchHistory(),
  setCached: (data) => cacheManager.cacheSearchHistory(data),
  fetchApi: () => fetchFromApi<string[]>(`/api/searchhistory`),
  eventName: 'searchHistoryUpdated',
  fallback: [],
});

const _getAllFavorites = createCacheFirstReader<Record<string, Favorite>>({
  getCached: () => cacheManager.getCachedFavorites(),
  setCached: (data) => cacheManager.cacheFavorites(data),
  fetchApi: () => fetchFromApi<Record<string, Favorite>>(`/api/favorites`),
  eventName: 'favoritesUpdated',
  fallback: {},
});

const _getAllSkipConfigs = createCacheFirstReader<Record<string, SkipConfig>>({
  getCached: () => cacheManager.getCachedSkipConfigs(),
  setCached: (data) => cacheManager.cacheSkipConfigs(data),
  fetchApi: () => fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`),
  eventName: 'skipConfigsUpdated',
  fallback: {},
  bgSyncErrorNotify: false,
});

// ================================================================
// 模式B工厂实例：乐观更新（写/删操作）
// ================================================================

const _writePlayRecords = createOptimisticWriter<Record<string, PlayRecord>>({
  getCached: () => cacheManager.getCachedPlayRecords(),
  setCached: (data) => cacheManager.cachePlayRecords(data),
  eventName: 'playRecordsUpdated',
  emptyCacheFactory: () => ({}),
});

const _writeFavorites = createOptimisticWriter<Record<string, Favorite>>({
  getCached: () => cacheManager.getCachedFavorites(),
  setCached: (data) => cacheManager.cacheFavorites(data),
  eventName: 'favoritesUpdated',
  emptyCacheFactory: () => ({}),
});

const _writeSearchHistory = createOptimisticWriter<string[]>({
  getCached: () => cacheManager.getCachedSearchHistory(),
  setCached: (data) => cacheManager.cacheSearchHistory(data),
  eventName: 'searchHistoryUpdated',
  emptyCacheFactory: () => [],
});

const _writeSkipConfigs = createOptimisticWriter<Record<string, SkipConfig>>({
  getCached: () => cacheManager.getCachedSkipConfigs(),
  setCached: (data) => cacheManager.cacheSkipConfigs(data),
  eventName: 'skipConfigsUpdated',
  emptyCacheFactory: () => ({}),
});

// ================================================================
// 导出的业务函数
// ================================================================

// ---- 播放记录 ----

export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  return _getAllPlayRecords();
}

export function getCachedPlayRecordsSnapshot(): Record<
  string,
  PlayRecord
> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return cacheManager.getCachedPlayRecords();
}

export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writePlayRecords({
    mutateCached: (cached) => {
      cached[key] = record;
      return cached;
    },
    mutateLocal: (stored) => {
      stored[key] = record;
      return stored;
    },
    syncToServer: () =>
      retryClientRequest(
        () =>
          fetchWithAuth('/api/playrecords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, record }),
            keepalive: true,
          }).then(() => {}),
        {
          retries: 2,
          delayMs: 600,
        },
      ),
    onServerError: async (err) => {
      await handleDatabaseOperationFailure('playRecords', err);
    },
  });
}

export async function deletePlayRecord(
  source: string,
  id: string,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writePlayRecords({
    mutateCached: (cached) => {
      delete cached[key];
      return cached;
    },
    mutateLocal: (stored) => {
      delete stored[key];
      return stored;
    },
    syncToServer: () =>
      fetchWithAuth(`/api/playrecords?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }).then(() => {}),
    onServerError: async (err) => {
      await handleDatabaseOperationFailure('playRecords', err);
    },
  });
}

export async function clearAllPlayRecords(): Promise<void> {
  cacheManager.cachePlayRecords({});
  window.dispatchEvent(new CustomEvent('playRecordsUpdated', { detail: {} }));
  try {
    await fetchWithAuth(`/api/playrecords`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await handleDatabaseOperationFailure('playRecords', err);
    throw err;
  }
}

// ---- 搜索历史 ----

export async function getSearchHistory(): Promise<string[]> {
  return _getSearchHistory();
}

export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  const buildNewHistory = (arr: string[]): string[] => {
    const newHistory = [trimmed, ...arr.filter((k) => k !== trimmed)];
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    return newHistory;
  };

  const cachedHistory = cacheManager.getCachedSearchHistory() || [];
  const newHistory = buildNewHistory(cachedHistory);
  cacheManager.cacheSearchHistory(newHistory);
  window.dispatchEvent(
    new CustomEvent('searchHistoryUpdated', { detail: newHistory }),
  );
  try {
    const res = await fetchWithAuth('/api/searchhistory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: trimmed }),
    });
    if (res.ok) {
      const serverHistory = (await res.json()) as string[];
      cacheManager.cacheSearchHistory(serverHistory);
      window.dispatchEvent(
        new CustomEvent('searchHistoryUpdated', { detail: serverHistory }),
      );
    }
  } catch (err) {
    await handleDatabaseOperationFailure('searchHistory', err);
  }
}

export async function clearSearchHistory(): Promise<void> {
  cacheManager.cacheSearchHistory([]);
  window.dispatchEvent(new CustomEvent('searchHistoryUpdated', { detail: [] }));
  try {
    await fetchWithAuth(`/api/searchhistory`, { method: 'DELETE' });
  } catch (err) {
    await handleDatabaseOperationFailure('searchHistory', err);
  }
}

export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  return _writeSearchHistory({
    mutateCached: (cached) => cached.filter((k) => k !== trimmed),
    mutateLocal: (stored) => stored.filter((k) => k !== trimmed),
    syncToServer: () =>
      fetchWithAuth(
        `/api/searchhistory?keyword=${encodeURIComponent(trimmed)}`,
        { method: 'DELETE' },
      ).then(() => {}),
    onServerError: async (err) => {
      await handleDatabaseOperationFailure('searchHistory', err);
    },
  });
}

// ---- 收藏 ----

export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  return _getAllFavorites();
}

export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeFavorites({
    mutateCached: (cached) => {
      cached[key] = favorite;
      return cached;
    },
    mutateLocal: (stored) => {
      stored[key] = favorite;
      return stored;
    },
    syncToServer: () =>
      fetchWithAuth('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, favorite }),
      }).then(() => {}),
    onServerError: async (err) => {
      await handleDatabaseOperationFailure('favorites', err);
    },
  });
}

export async function deleteFavorite(
  source: string,
  id: string,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeFavorites({
    mutateCached: (cached) => {
      delete cached[key];
      return cached;
    },
    mutateLocal: (stored) => {
      delete stored[key];
      return stored;
    },
    syncToServer: () =>
      fetchWithAuth(`/api/favorites?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }).then(() => {}),
    onServerError: async (err) => {
      await handleDatabaseOperationFailure('favorites', err);
    },
  });
}

export async function isFavorited(
  source: string,
  id: string,
): Promise<boolean> {
  const key = generateStorageKey(source, id);

  // 未认证时直接返回 false
  const authInfo = getAuthInfoFromBrowserCookie();
  if (!authInfo?.username) {
    return false;
  }

  const cachedFavorites = cacheManager.getCachedFavorites();

  if (cachedFavorites) {
    fetchFromApi<Record<string, Favorite>>(`/api/favorites`)
      .then((freshData) => {
        if (JSON.stringify(cachedFavorites) !== JSON.stringify(freshData)) {
          cacheManager.cacheFavorites(freshData);
          window.dispatchEvent(
            new CustomEvent('favoritesUpdated', { detail: freshData }),
          );
        }
      })
      .catch((err) => {
        console.warn('后台同步收藏失败:', err);
        triggerGlobalError('后台同步收藏失败');
      });

    return !!cachedFavorites[key];
  }

  try {
    const freshData =
      await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
    cacheManager.cacheFavorites(freshData);
    return !!freshData[key];
  } catch (err) {
    console.error('检查收藏状态失败:', err);
    triggerGlobalError('检查收藏状态失败');
    return false;
  }
}

export async function clearAllFavorites(): Promise<void> {
  cacheManager.cacheFavorites({});
  window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: {} }));
  try {
    await fetchWithAuth(`/api/favorites`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await handleDatabaseOperationFailure('favorites', err);
    throw err;
  }
}

// ---- 跳过片头片尾配置 ----

export async function getSkipConfig(
  source: string,
  id: string,
): Promise<SkipConfig | null> {
  if (typeof window === 'undefined') return null;
  const key = generateStorageKey(source, id);
  const allConfigs = await _getAllSkipConfigs();
  return allConfigs[key] || null;
}

export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeSkipConfigs({
    mutateCached: (cached) => {
      cached[key] = config;
      return cached;
    },
    mutateLocal: (stored) => {
      stored[key] = config;
      return stored;
    },
    syncToServer: () =>
      fetchWithAuth('/api/skipconfigs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, config }),
      }).then(() => {}),
    onServerError: async (err) => {
      console.error('保存跳过片头片尾配置失败:', err);
      triggerGlobalError('保存跳过片头片尾配置失败');
    },
  });
}

export async function deleteSkipConfig(
  source: string,
  id: string,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeSkipConfigs({
    mutateCached: (cached) => {
      delete cached[key];
      return cached;
    },
    mutateLocal: (stored) => {
      delete stored[key];
      return stored;
    },
    syncToServer: () =>
      fetchWithAuth(`/api/skipconfigs?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }).then(() => {}),
    onServerError: async (err) => {
      console.error('删除跳过片头片尾配置失败:', err);
      triggerGlobalError('删除跳过片头片尾配置失败');
    },
  });
}

// ---- React Hook 辅助类型 ----

export type CacheUpdateEvent =
  | 'playRecordsUpdated'
  | 'favoritesUpdated'
  | 'searchHistoryUpdated'
  | 'skipConfigsUpdated';

export function subscribeToDataUpdates<T>(
  eventType: CacheUpdateEvent,
  callback: (data: T) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleUpdate = (event: CustomEvent) => {
    callback(event.detail);
  };

  window.addEventListener(eventType, handleUpdate as EventListener);

  return () => {
    window.removeEventListener(eventType, handleUpdate as EventListener);
  };
}
