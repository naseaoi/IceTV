import {
  DEFAULT_CACHE_PROFILE,
  getProfileTotalBytes,
  getServerCacheBudget,
  resolveCacheProfileName,
} from '@/lib/cache-budget-profile';

describe('cache budget profile', () => {
  it('默认档位为 small，非法值回落默认', () => {
    expect(DEFAULT_CACHE_PROFILE).toBe('small');
    expect(resolveCacheProfileName(undefined)).toBe('small');
    expect(resolveCacheProfileName('')).toBe('small');
    expect(resolveCacheProfileName('huge')).toBe('small');
  });

  it('识别合法档位并忽略大小写与空白', () => {
    expect(resolveCacheProfileName('standard')).toBe('standard');
    expect(resolveCacheProfileName('  STANDARD ')).toBe('standard');
    expect(resolveCacheProfileName('Small')).toBe('small');
  });

  it('small 档总预算显著低于 standard 且控制在 100MB 内', () => {
    const small = getProfileTotalBytes('small');
    const standard = getProfileTotalBytes('standard');

    expect(small).toBeLessThan(standard);
    expect(small).toBeLessThanOrEqual(100 * 1024 * 1024);
  });

  it('每个缓存在两档下都给出正数上限', () => {
    const caches = [
      'search-pages',
      'search-empty-pages',
      'search-aggregates',
      'detail',
      'cover-image-resize',
      'proxy-m3u8',
      'proxy-m3u8-rewrite',
      'douban-route',
      'douban-recommends',
      'episode-url',
    ] as const;

    for (const cache of caches) {
      for (const profile of ['small', 'standard'] as const) {
        const budget = getServerCacheBudget(cache, profile);
        expect(budget.maxSize).toBeGreaterThan(0);
        expect(budget.maxWeightBytes).toBeGreaterThan(0);
      }
    }
  });
});
