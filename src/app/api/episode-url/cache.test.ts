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
    const signedUrl = 'https://cdn.example/play.m3u8?sign=abc&expires=1';
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
