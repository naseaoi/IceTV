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
    const maxAge = 60 * 24 * 60 * 60 * 1000;

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

if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}
