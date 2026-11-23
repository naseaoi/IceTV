/**
 * @jest-environment node
 */
import type { ApiSite } from '@/lib/config';

import { episodeUrlCache, getEpisodeUrlCacheKey } from './cache';

const source: ApiSite = {
  key: 'giri',
  name: 'Giri',
  api: 'https://old.example',
  detail: 'https://detail.example',
};
const lazyUrl = 'icetv-lazy://giri/video/123';

describe('episode URL cache keys', () => {
  beforeEach(() => episodeUrlCache.clear());

  it.each([
    { api: 'https://new.example' },
    { detail: 'https://new-detail.example' },
    { name: 'Changed source' },
    { key: 'another-source' },
  ])('isolates source configuration changes: %o', async (change) => {
    const oldKey = getEpisodeUrlCacheKey(source, lazyUrl);
    const newKey = getEpisodeUrlCacheKey({ ...source, ...change }, lazyUrl);
    const loader = jest.fn(async () => 'new-play-url');
    episodeUrlCache.set(oldKey, 'old-play-url');
    expect(newKey).not.toBe(oldKey);
    await expect(episodeUrlCache.getOrLoad(newKey, loader)).resolves.toBe(
      'new-play-url',
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'https://cdn.example/rejected.m3u8',
      'https://cdn.example/new.m3u8?token=fresh',
    ],
    [
      'https://cdn.example/rejected.m3u8?token=old',
      'https://cdn.example/new.m3u8',
    ],
  ])(
    'bypasses cached %s on refresh and reuses the new local result',
    async (oldUrl, freshUrl) => {
      const key = getEpisodeUrlCacheKey(source, lazyUrl);
      episodeUrlCache.set(key, oldUrl);
      const loader = jest.fn(async () => freshUrl);
      await expect(
        Promise.all([
          episodeUrlCache.refresh(key, loader),
          episodeUrlCache.refresh(key, loader),
          episodeUrlCache.getOrLoad(key, loader),
        ]),
      ).resolves.toEqual([freshUrl, freshUrl, freshUrl]);
      await expect(episodeUrlCache.getOrLoad(key, loader)).resolves.toBe(
        freshUrl,
      );
      expect(loader).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps a refreshed URL ahead of an older in-flight resolution', async () => {
    const key = getEpisodeUrlCacheKey(source, lazyUrl);
    let finish!: (url: string) => void;
    const pending = episodeUrlCache.getOrLoad(
      key,
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const freshUrl = 'https://cdn.example/fresh.m3u8';
    const refresh = jest.fn(async () => freshUrl);
    await episodeUrlCache.refresh(key, refresh);
    finish('https://cdn.example/stale.m3u8?token=old');
    await pending;
    await expect(episodeUrlCache.getOrLoad(key, refresh)).resolves.toBe(
      freshUrl,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reuses unchanged configuration and separates lazy episode addresses', () => {
    const key = getEpisodeUrlCacheKey(source, lazyUrl);
    expect(getEpisodeUrlCacheKey({ ...source }, lazyUrl)).toBe(key);
    expect(getEpisodeUrlCacheKey(source, `${lazyUrl}/2`)).not.toBe(key);
  });
});

describe('episode URL sharing', () => {
  function loadCacheWithSharedSpy() {
    const sharedOptions: Array<{ shouldCache?: (url: string) => boolean }> = [];
    const sharedLoads = jest.fn(
      async (_key: string, loader: () => Promise<string>) => loader(),
    );
    let cache!: typeof import('./cache');
    jest.isolateModules(() => {
      jest.doMock('@/lib/shared-server-cache', () => ({
        createSharedServerCache: (options: {
          shouldCache?: (url: string) => boolean;
        }) => {
          sharedOptions.push(options);
          return {
            getOrLoad: sharedLoads,
            set: jest.fn(),
            clear: jest.fn(),
            stats: jest.fn(),
          };
        },
      }));
      cache = require('./cache');
    });
    return { cache, sharedLoads, shouldCache: sharedOptions[0].shouldCache! };
  }

  afterEach(() => jest.dontMock('@/lib/shared-server-cache'));

  it('shares plain addresses and keeps signed ones on this instance', async () => {
    const { cache, sharedLoads, shouldCache } = loadCacheWithSharedSpy();
    const signedUrl = 'https://cdn.example/play.m3u8?sign=abc';
    expect(shouldCache('https://cdn.example/play.m3u8')).toBe(true);
    expect(shouldCache(signedUrl)).toBe(false);

    const key = cache.getEpisodeUrlCacheKey(source, lazyUrl);
    const loader = jest.fn(async () => signedUrl);
    await expect(cache.episodeUrlCache.getOrLoad(key, loader)).resolves.toBe(
      signedUrl,
    );
    await expect(cache.episodeUrlCache.getOrLoad(key, loader)).resolves.toBe(
      signedUrl,
    );
    expect(loader).toHaveBeenCalledTimes(1);
    expect(sharedLoads).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['?sign=abc&expires=1794960060', 30_000],
    ['?token=abc', 5 * 60_000],
    ['?signature=abc&oss_expires=1794960060000', 30_000],
    [
      '?X-Amz-Signature=abc&X-Amz-Date=20261118T000000Z&X-Amz-Expires=60',
      30_000,
    ],
  ])('never serves a stale signed address (%s)', async (query, lifetime) => {
    const { cache } = loadCacheWithSharedSpy();
    const now = 1794960000000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const key = cache.getEpisodeUrlCacheKey(source, lazyUrl);
      const signed = `https://cdn.example/play.m3u8${query}`;
      const loader = jest
        .fn()
        .mockResolvedValueOnce(signed)
        .mockRejectedValueOnce(new Error('refresh failed'));
      await expect(cache.episodeUrlCache.getOrLoad(key, loader)).resolves.toBe(
        signed,
      );
      clock.mockReturnValue(now + lifetime - 1);
      await expect(cache.episodeUrlCache.getOrLoad(key, loader)).resolves.toBe(
        signed,
      );
      clock.mockReturnValue(now + lifetime);
      await expect(
        cache.episodeUrlCache.getOrLoad(key, loader),
      ).rejects.toThrow('refresh failed');
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('stops waiting for a shared load when the request is aborted', async () => {
    const { cache, sharedLoads } = loadCacheWithSharedSpy();
    sharedLoads.mockImplementation(() => new Promise<string>(() => {}));
    const controller = new AbortController();
    const pending = cache.episodeUrlCache.getOrLoad(
      cache.getEpisodeUrlCacheKey(source, lazyUrl),
      async () => 'unused',
      controller.signal,
    );
    controller.abort(new Error('aborted'));
    await expect(pending).rejects.toThrow('aborted');
  });
});
