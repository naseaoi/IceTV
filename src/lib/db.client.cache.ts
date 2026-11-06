import {
  listStorageKeys,
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';

import { getAuthInfoFromBrowserCookie } from './auth.client';
import type { Favorite, PlayRecord, SkipConfig } from './types';

type CacheData<T> = {
  data: T;
  timestamp: number;
  version: string;
};

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
}

const CACHE_PREFIX = 'icetv_cache_';
const LEGACY_CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000;

function getStorageValueWithLegacy(
  key: string,
  legacyKey?: string,
): string | null {
  const raw = readStorage(key);
  if (raw !== null) {
    return raw;
  }
  if (!legacyKey) {
    return null;
  }
  const legacyRaw = readStorage(legacyKey);
  if (legacyRaw !== null) {
    writeStorage(key, legacyRaw);
  }
  return legacyRaw;
}

class HybridCacheManager {
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
      const payload = JSON.stringify(cache);
      if (writeStorage(cacheKey, payload)) return;
      // 写入失败多为配额已满，清掉本模块缓存后重试一次
      this.clearAllCache();
      if (!writeStorage(cacheKey, payload)) {
        console.warn('保存用户缓存失败');
      }
    } catch (error) {
      console.warn('保存用户缓存失败:', error);
    }
  }

  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000;

    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }
  }

  private clearAllCache(): void {
    [
      ...listStorageKeys(CACHE_PREFIX),
      ...listStorageKeys(LEGACY_CACHE_PREFIX),
    ].forEach(removeStorage);
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

  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;
    removeStorage(this.getUserCacheKey(targetUsername));
  }

  clearExpiredCaches(): void {
    const keysToRemove = listStorageKeys(CACHE_PREFIX).filter((key) => {
      try {
        const cache = JSON.parse(readStorage(key) || '{}');
        return !Object.values(cache).some(
          (cacheData) =>
            cacheData && this.isCacheValid(cacheData as CacheData<unknown>),
        );
      } catch {
        return true;
      }
    });
    keysToRemove.forEach(removeStorage);
  }
}

export const cacheManager = HybridCacheManager.getInstance();

if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}
