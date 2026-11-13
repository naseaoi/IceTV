'use client';

import type {
  FavoriteBatchInput,
  FavoriteLibraryItem,
  FavoriteWorkQuery,
} from '@/features/favorites/lib/library-query';
import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';

import { getAuthInfoFromBrowserCookie } from './auth.client';
import { isCatalogFavoriteSource } from './catalog-favorites';
import {
  cacheManager,
  createCacheFirstReader,
  createKeyedCacheFirstReader,
  createKeyedNetworkReader,
  createOptimisticWriter,
  fetchFromApi,
  fetchWithAuth,
  handleDatabaseOperationFailure,
  reportPlaybackRecordsReadFailure,
  retryClientRequest,
} from './db.client.internal';
import type { PlayRecordPage } from './play-records';
import {
  DEFAULT_RECENT_PLAY_RECORD_LIMIT,
  MAX_DELETE_PLAY_RECORD_KEYS,
  MAX_READ_PLAY_RECORD_KEYS,
  mergePlayRecordUpdateBaseline,
  normalizePlayRecordLimit,
  selectRecentPlayRecords,
} from './play-records';
import { getRuntimeConfig } from './runtime-config';
import type { Favorite, PlayRecord, SkipConfig } from './types';

export type { Favorite, PlayRecord, SkipConfig } from './types';

function getSearchHistoryLimit(): number {
  return Math.max(
    1,
    Math.floor(getRuntimeConfig()?.SEARCH_HISTORY_LIMIT || 20),
  );
}

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

async function fetchPlayRecordsByKeys(
  keys: string[],
  signal: AbortSignal,
): Promise<Record<string, PlayRecord>> {
  const records: Record<string, PlayRecord> = {};
  for (let index = 0; index < keys.length; index += MAX_READ_PLAY_RECORD_KEYS) {
    if (signal.aborted)
      throw signal.reason ?? new DOMException('Request aborted', 'AbortError');
    const params = new URLSearchParams();
    keys
      .slice(index, index + MAX_READ_PLAY_RECORD_KEYS)
      .forEach((key) => params.append('keys', key));
    Object.assign(
      records,
      await fetchFromApi<Record<string, PlayRecord>>(
        `/api/playrecords?${params}`,
        { signal },
      ),
    );
  }
  return records;
}

const _readPlayRecordsForPlayback = createKeyedNetworkReader<PlayRecord>({
  getCached: () => cacheManager.getCachedPlayRecords(),
  setCached: (data) => cacheManager.cachePlayRecords(data),
  fetchApi: fetchPlayRecordsByKeys,
  eventName: 'playRecordsUpdated',
});

const _getFavorite = createKeyedCacheFirstReader<Favorite>({
  getCached: () => cacheManager.getCachedFavorites(),
  setCached: (data) => cacheManager.cacheFavorites(data),
  fetchApi: async ([key]) => {
    const favorite = await fetchFromApi<Favorite | null>(
      `/api/favorites?key=${encodeURIComponent(key)}`,
    );
    return favorite ? { [key]: favorite } : {};
  },
  eventName: 'favoritesUpdated',
});

const _getSkipConfig = createKeyedCacheFirstReader<SkipConfig>({
  getCached: () => cacheManager.getCachedSkipConfigs(),
  setCached: (data) => cacheManager.cacheSkipConfigs(data),
  fetchApi: async ([key]) => {
    const separator = key.indexOf('+');
    const params = new URLSearchParams({
      source: key.slice(0, separator),
      id: key.slice(separator + 1),
    });
    const config = await fetchFromApi<SkipConfig | null>(
      `/api/skipconfigs?${params}`,
    );
    return config ? { [key]: config } : {};
  },
  eventName: 'skipConfigsUpdated',
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

export interface PlaybackRecordsRead {
  cached: Record<string, PlayRecord> | null;
  fresh: Promise<Record<string, PlayRecord>>;
}

export { reportPlaybackRecordsReadFailure };

export function readPlayRecordsForPlayback(
  keys: string[],
  options?: { timeoutMs?: number },
): PlaybackRecordsRead {
  return _readPlayRecordsForPlayback(keys, options);
}

export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  return _getAllPlayRecords();
}

export async function getRecentPlayRecords(
  limit = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
): Promise<Record<string, PlayRecord>> {
  const normalizedLimit = normalizePlayRecordLimit(limit);
  const cachedRecords = cacheManager.getCachedPlayRecords();
  const requestRecentRecords = () =>
    fetchFromApi<Record<string, PlayRecord>>(
      `/api/playrecords?limit=${normalizedLimit}`,
    );

  if (cachedRecords) {
    void requestRecentRecords()
      .then((freshRecords) => {
        window.dispatchEvent(
          new CustomEvent('recentPlayRecordsUpdated', {
            detail: freshRecords,
          }),
        );
      })
      .catch((error) => {
        console.warn('后台同步最近播放记录失败:', error);
      });

    return selectRecentPlayRecords(cachedRecords, normalizedLimit);
  }

  try {
    return await requestRecentRecords();
  } catch (error) {
    console.error('获取最近播放记录失败:', error);
    return {};
  }
}

export async function getPlayRecordPage(
  limit = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
  cursor?: string | null,
  options?: { filter?: 'updated' | 'shelved' },
): Promise<PlayRecordPage> {
  const normalizedLimit = normalizePlayRecordLimit(limit);
  const params = new URLSearchParams({
    format: 'page',
    limit: String(normalizedLimit),
  });
  if (cursor) {
    params.set('cursor', cursor);
  }

  if (options?.filter) {
    params.set('filter', options.filter);
  }

  const page = await fetchFromApi<PlayRecordPage>(
    `/api/playrecords?${params.toString()}`,
  );
  mergePlayRecordsIntoCache(page.items);
  return page;
}

function mergePlayRecordsIntoCache(items: Record<string, PlayRecord>): void {
  if (typeof window === 'undefined') return;

  const cachedRecords = cacheManager.getCachedPlayRecords();
  if (!cachedRecords) return;

  cacheManager.cachePlayRecords({ ...cachedRecords, ...items });
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
  const cached = cacheManager.getCachedPlayRecords();
  const normalizedRecord = mergePlayRecordUpdateBaseline(cached?.[key], record);
  return _writePlayRecords({
    rollbackOnError: false,
    affectedKeys: [key],
    mutateCached: (cached) => {
      cached[key] = normalizedRecord;
      return cached;
    },
    syncToServer: () =>
      retryClientRequest(
        () =>
          fetchWithAuth('/api/playrecords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, record: normalizedRecord }),
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
  await _writePlayRecords({
    affectedKeys: [key],
    mutateCached: (cached) => {
      delete cached[key];
      return cached;
    },
    syncToServer: () =>
      fetchWithAuth(`/api/playrecords?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }).then(() => {}),
    onServerError: async (err) => {
      await handleDatabaseOperationFailure(
        'playRecords',
        err,
        '删除播放记录失败，请重试',
      );
    },
    requireExistingCacheForOptimisticUpdate: true,
  });
  notifyMessagesUpdated();
}

export async function deletePlayRecords(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const uniqueKeys = [...new Set(keys)];
  for (
    let offset = 0;
    offset < uniqueKeys.length;
    offset += MAX_DELETE_PLAY_RECORD_KEYS
  ) {
    const batch = uniqueKeys.slice(
      offset,
      offset + MAX_DELETE_PLAY_RECORD_KEYS,
    );
    await _writePlayRecords({
      affectedKeys: batch,
      mutateCached: (cached) => {
        for (const key of batch) delete cached[key];
        return cached;
      },
      syncToServer: () =>
        fetchWithAuth('/api/playrecords', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: batch }),
        }).then(() => {}),
      onServerError: (err) =>
        handleDatabaseOperationFailure(
          'playRecords',
          err,
          offset
            ? `已删除 ${offset} 条，${uniqueKeys.length - offset} 条未删除，请重试`
            : '删除播放记录失败，请重试',
        ),
      requireExistingCacheForOptimisticUpdate: true,
    });
  }
  notifyMessagesUpdated();
}

async function patchPlayRecordState(
  source: string,
  id: string,
  body: Record<string, unknown>,
  failureMessage: string,
): Promise<PlayRecord> {
  try {
    const key = generateStorageKey(source, id);
    const response = await fetchWithAuth('/api/playrecords', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, ...body }),
    });
    const record = (await response.json()) as PlayRecord;
    const cachedRecords = cacheManager.getCachedPlayRecords();

    if (cachedRecords?.[key]) {
      const nextRecords = { ...cachedRecords, [key]: record };
      cacheManager.cachePlayRecords(nextRecords);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', { detail: nextRecords }),
      );
    }

    return record;
  } catch (error) {
    await handleDatabaseOperationFailure('playRecords', error, failureMessage);
    throw error;
  }
}

function notifyMessagesUpdated(): void {
  window.dispatchEvent(new CustomEvent('messagesUpdated'));
}

export async function markPlayRecordUpdateRead(
  source: string,
  id: string,
  readThroughEpisodes?: number,
): Promise<PlayRecord> {
  const record = await patchPlayRecordState(
    source,
    id,
    {
      action: 'mark-update-read',
      readThroughEpisodes,
    },
    '标记已读失败，请重试',
  );
  notifyMessagesUpdated();
  return record;
}

export async function setPlayRecordTracking(
  source: string,
  id: string,
  enabled: boolean,
): Promise<PlayRecord> {
  const record = await patchPlayRecordState(
    source,
    id,
    {
      action: 'set-tracking',
      trackingEnabled: enabled,
    },
    '追更设置保存失败，请重试',
  );
  notifyMessagesUpdated();
  return record;
}

export async function clearAllPlayRecords(): Promise<void> {
  await _writePlayRecords({
    affectedKeys: 'all',
    mutateCached: () => ({}),
    syncToServer: () =>
      fetchWithAuth('/api/playrecords', { method: 'DELETE' }).then(() => {}),
    onServerError: (err) =>
      handleDatabaseOperationFailure(
        'playRecords',
        err,
        '删除播放记录失败，请重试',
      ),
  });
  notifyMessagesUpdated();
}

export function applyPlayRecordStateUpdates(
  updates: Record<string, PlayRecord>,
): void {
  const cachedRecords = cacheManager.getCachedPlayRecords();
  if (cachedRecords) {
    cacheManager.cachePlayRecords({ ...cachedRecords, ...updates });
  }
  window.dispatchEvent(
    new CustomEvent('playRecordStatesUpdated', { detail: updates }),
  );
}

// ---- 搜索历史 ----

export async function getSearchHistory(): Promise<string[]> {
  return _getSearchHistory();
}

export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = normalizeSearchQueryInput(keyword);
  if (!trimmed) return;

  const buildNewHistory = (arr: string[]): string[] => {
    const newHistory = [trimmed, ...arr.filter((k) => k !== trimmed)];
    const limit = getSearchHistoryLimit();
    if (newHistory.length > limit) {
      newHistory.length = limit;
    }
    return newHistory;
  };

  try {
    await _writeSearchHistory({
      affectedKeys: [trimmed],
      rollbackOnError: false,
      mutateCached: buildNewHistory,
      syncToServer: () =>
        fetchWithAuth('/api/searchhistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: trimmed }),
        }).then(() => {}),
      onServerError: (err) =>
        handleDatabaseOperationFailure('searchHistory', err),
    });
  } catch {
    // 自动记录搜索历史的失败由数据层反馈。
  }
}

export async function clearSearchHistory(): Promise<void> {
  await _writeSearchHistory({
    affectedKeys: 'all',
    mutateCached: () => [],
    syncToServer: () =>
      fetchWithAuth('/api/searchhistory', { method: 'DELETE' }).then(() => {}),
    onServerError: (err) =>
      handleDatabaseOperationFailure(
        'searchHistory',
        err,
        '清空搜索历史失败，请重试',
      ),
  });
}

export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = normalizeSearchQueryInput(keyword);
  if (!trimmed) return;

  return _writeSearchHistory({
    affectedKeys: [trimmed],
    mutateCached: (cached) => cached.filter((k) => k !== trimmed),
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

export function getCachedFavoritesSnapshot(): Record<string, Favorite> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return cacheManager.getCachedFavorites();
}

async function refreshFavoritesAfterWrite(
  expectedUsername?: string,
): Promise<void> {
  const favorites =
    await fetchFromApi<Record<string, Favorite>>('/api/favorites');
  if (
    expectedUsername &&
    getAuthInfoFromBrowserCookie()?.username !== expectedUsername
  )
    return;
  cacheManager.cacheFavorites(favorites);
  window.dispatchEvent(
    new CustomEvent('favoritesUpdated', { detail: favorites }),
  );
  window.dispatchEvent(new Event('userLibraryUpdated'));
}

export async function getFavoriteForWork(
  work: FavoriteWorkQuery,
): Promise<FavoriteLibraryItem | null> {
  const params = new URLSearchParams({ format: 'work', ...work });
  return fetchFromApi<FavoriteLibraryItem | null>(
    `/api/favorites?${params.toString()}`,
  );
}

export async function batchFavorites(
  input: FavoriteBatchInput,
): Promise<{ affected: number }> {
  try {
    const result = await fetchWithAuth('/api/favorites/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await result.json()) as { affected: number };
    await refreshFavoritesAfterWrite();
    return data;
  } catch (error) {
    await handleDatabaseOperationFailure('favorites', error);
    throw error;
  }
}

const catalogBindingSessions = new Set<string>();

export async function bindCatalogFavorites(key?: string): Promise<void> {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username) return;
  if (!key) {
    if (catalogBindingSessions.has(username)) return;
    catalogBindingSessions.add(username);
  }
  try {
    const response = await fetchWithAuth('/api/favorites/catalog-bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(key ? { key } : {}),
    });
    const payload = await response.json();
    const results = key ? [payload] : payload.results;
    if (getAuthInfoFromBrowserCookie()?.username !== username) return;
    if (
      Array.isArray(results) &&
      results.some((result) => result.status === 'bound')
    ) {
      await refreshFavoritesAfterWrite(username);
    }
  } catch {
    // 后台补绑定失败保持目录收藏，等待下一会话按服务端退避重试。
  }
}

export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite,
): Promise<string> {
  const key = generateStorageKey(source, id);
  try {
    const response = await fetchWithAuth('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, favorite }),
    });
    const result = (await response.json()) as { key: string };
    // 合并可能删除另一目录键，成功后以服务端快照刷新，避免缓存保留幽灵收藏。
    await refreshFavoritesAfterWrite();
    if (isCatalogFavoriteSource(result.key.split('+')[0])) {
      void bindCatalogFavorites(result.key);
    }
    return result.key;
  } catch (error) {
    await handleDatabaseOperationFailure('favorites', error);
    throw error;
  }
}

export async function setFavoriteTracking(
  source: string,
  id: string,
  enabled: boolean,
): Promise<Favorite> {
  const key = generateStorageKey(source, id);
  try {
    const response = await fetchWithAuth('/api/favorites', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, trackingEnabled: enabled }),
    });
    const { favorite } = (await response.json()) as { favorite: Favorite };
    const cached = cacheManager.getCachedFavorites();
    if (cached?.[key]) {
      const next = { ...cached, [key]: favorite };
      cacheManager.cacheFavorites(next);
      window.dispatchEvent(
        new CustomEvent('favoritesUpdated', { detail: next }),
      );
    }
    notifyMessagesUpdated();
    return favorite;
  } catch (error) {
    await handleDatabaseOperationFailure(
      'favorites',
      error,
      '追更设置保存失败，请重试',
    );
    throw error;
  }
}

export async function deleteFavorite(
  source: string,
  id: string,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeFavorites({
    affectedKeys: [key],
    mutateCached: (cached) => {
      delete cached[key];
      return cached;
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

  return !!(await _getFavorite([key]))[key];
}

export async function clearAllFavorites(): Promise<void> {
  await _writeFavorites({
    affectedKeys: 'all',
    mutateCached: () => ({}),
    syncToServer: () =>
      fetchWithAuth('/api/favorites', { method: 'DELETE' }).then(() => {}),
    onServerError: (err) =>
      handleDatabaseOperationFailure('favorites', err, '清空收藏失败，请重试'),
  });
}

// ---- 跳过片头片尾配置 ----

export async function getSkipConfig(
  source: string,
  id: string,
): Promise<SkipConfig | null> {
  if (typeof window === 'undefined') return null;
  const key = generateStorageKey(source, id);
  const configs = await _getSkipConfig([key]);
  return configs[key] || null;
}

export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeSkipConfigs({
    affectedKeys: [key],
    mutateCached: (cached) => {
      cached[key] = config;
      return cached;
    },
    syncToServer: () =>
      fetchWithAuth('/api/skipconfigs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, config }),
      }).then(() => {}),
    onServerError: async (err) => {
      console.error('保存跳过片头片尾配置失败:', err);
    },
  });
}

export async function deleteSkipConfig(
  source: string,
  id: string,
): Promise<void> {
  const key = generateStorageKey(source, id);
  return _writeSkipConfigs({
    affectedKeys: [key],
    mutateCached: (cached) => {
      delete cached[key];
      return cached;
    },
    syncToServer: () =>
      fetchWithAuth(`/api/skipconfigs?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }).then(() => {}),
    onServerError: async (err) => {
      console.error('删除跳过片头片尾配置失败:', err);
    },
  });
}

// ---- React Hook 辅助类型 ----

export type CacheUpdateEvent =
  | 'playRecordsUpdated'
  | 'recentPlayRecordsUpdated'
  | 'playRecordStatesUpdated'
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
