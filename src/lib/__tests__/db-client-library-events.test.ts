import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { setFavoriteTracking } from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import { createOptimisticWriter } from '@/lib/db.client.internal';
import type { Favorite } from '@/lib/types';

jest.mock('@/lib/auth.client', () => ({
  AUTH_SESSION_LOST_EVENT: 'auth:session-lost',
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

installWebPolyfills();

const favorite: Favorite = {
  title: '剧集',
  source_name: '源',
  total_episodes: 12,
  year: '2026',
  cover: '',
  save_time: 1,
};

describe.each(['hit', 'missing-key', 'empty'] as const)(
  '收藏追更写入通知（缓存 %s）',
  (cacheState) => {
    const originalFetch = global.fetch;
    const libraryUpdated = jest.fn((event: Event) => ({
      event,
      favorites: cacheManager.getCachedFavorites(),
    }));
    const favoritesUpdated = jest.fn();
    const messagesUpdated = jest.fn();
    let fetchMock: jest.Mock;
    let initialCache: Record<string, Favorite> | null;

    beforeEach(() => {
      jest.clearAllMocks();
      cacheManager.clearUserCache();
      initialCache =
        cacheState === 'empty'
          ? null
          : {
              'src+2': favorite,
              ...(cacheState === 'hit' ? { 'src+1': favorite } : {}),
            };
      if (initialCache) cacheManager.cacheFavorites(initialCache);
      fetchMock = jest.fn();
      global.fetch = fetchMock;
      window.addEventListener('userLibraryUpdated', libraryUpdated);
      window.addEventListener('favoritesUpdated', favoritesUpdated);
      window.addEventListener('messagesUpdated', messagesUpdated);
    });

    afterEach(() => {
      window.removeEventListener('userLibraryUpdated', libraryUpdated);
      window.removeEventListener('favoritesUpdated', favoritesUpdated);
      window.removeEventListener('messagesUpdated', messagesUpdated);
      cacheManager.clearUserCache();
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });

    it.each([true, false])('成功设置追更为 %s 后通知一次', async (enabled) => {
      let resolve!: (response: Response) => void;
      fetchMock.mockReturnValue(
        new Promise<Response>((done) => {
          resolve = done;
        }),
      );
      const pending = setFavoriteTracking('src', '1', enabled);
      expect(libraryUpdated).not.toHaveBeenCalled();
      expect(favoritesUpdated).not.toHaveBeenCalled();
      expect(messagesUpdated).not.toHaveBeenCalled();

      const updated = { ...favorite, tracking_enabled: enabled };
      const response = new Response(JSON.stringify({ favorite: updated }));
      // 轻量 Response polyfill 未实现 ok，客户端请求封装依赖此属性。
      Object.defineProperty(response, 'ok', { value: true });
      resolve(response);
      await expect(pending).resolves.toEqual(updated);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/favorites',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ key: 'src+1', trackingEnabled: enabled }),
        }),
      );
      expect(libraryUpdated).toHaveBeenCalledTimes(1);
      expect(libraryUpdated).toHaveBeenCalledWith(expect.any(Event));
      expect(libraryUpdated.mock.calls[0][0]).not.toHaveProperty('detail');
      expect(favoritesUpdated).toHaveBeenCalledTimes(
        cacheState === 'hit' ? 1 : 0,
      );
      const expectedCache =
        cacheState === 'hit'
          ? { ...initialCache, 'src+1': updated }
          : initialCache;
      expect(libraryUpdated.mock.results[0].value.favorites).toEqual(
        expectedCache,
      );
      expect(cacheManager.getCachedFavorites()).toEqual(expectedCache);
      if (cacheState === 'hit') {
        expect(favoritesUpdated.mock.calls[0][0].detail).toEqual(expectedCache);
      }
      expect(messagesUpdated).toHaveBeenCalledTimes(1);
    });

    it('PATCH 失败时保持缓存并跳过完成及消息通知', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

      await expect(setFavoriteTracking('src', '1', false)).rejects.toThrow();

      expect(libraryUpdated).not.toHaveBeenCalled();
      expect(favoritesUpdated).not.toHaveBeenCalled();
      expect(messagesUpdated).not.toHaveBeenCalled();
      expect(cacheManager.getCachedFavorites()).toEqual(initialCache);
    });
  },
);

it.each(['favoritesUpdated', 'playRecordsUpdated'] as const)(
  'invalidates server library only after %s mutation settles',
  async (eventName) => {
    const invalidate = jest.fn();
    window.addEventListener('userLibraryUpdated', invalidate);
    let resolve!: () => void;
    const writer = createOptimisticWriter({
      getCached: () => ({}),
      setCached: jest.fn(),
      eventName,
      emptyCacheFactory: () => ({}),
    });
    try {
      const pending = writer({
        mutateCached: (value) => value,
        syncToServer: () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      });
      expect(invalidate).not.toHaveBeenCalled();
      resolve();
      await pending;
      expect(invalidate).toHaveBeenCalledTimes(1);
      const rollback = jest.fn().mockResolvedValue(undefined);
      await expect(
        writer({
          mutateCached: (value) => value,
          syncToServer: async () => {
            throw new Error('failed');
          },
          onServerError: rollback,
        }),
      ).rejects.toThrow('failed');
      expect(rollback).toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('userLibraryUpdated', invalidate);
    }
  },
);
