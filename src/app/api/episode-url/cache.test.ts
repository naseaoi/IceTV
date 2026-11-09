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
