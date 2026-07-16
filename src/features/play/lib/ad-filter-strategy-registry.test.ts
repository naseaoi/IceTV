import {
  getAdFilterCacheNamespace,
  getRegisteredAdFilterSources,
  getSourceAdFilterStrategy,
  shouldFilterAdsOnClient,
  shouldRunServerAdFilter,
} from '@/features/play/lib/ad-filter-strategy-registry';

describe('ad-filter-strategy-registry', () => {
  it('如意资源使用独立服务端策略', () => {
    const strategy = getSourceAdFilterStrategy('rycj');

    expect(strategy).toMatchObject({
      id: 'rycj-periodic-blocks',
      version: 1,
      execution: 'server',
    });
    expect(strategy?.server?.timeline).toBe('continuous-periodic');
    expect(strategy?.server?.signals).toContain('periodic-duration-profile');
    expect(shouldRunServerAdFilter('rycj')).toBe(true);
    expect(shouldFilterAdsOnClient('rycj')).toBe(false);
  });

  it('未注册源沿用客户端通用过滤', () => {
    expect(getSourceAdFilterStrategy('ffzy')).toBeNull();
    expect(shouldRunServerAdFilter('ffzy')).toBe(false);
    expect(shouldFilterAdsOnClient('ffzy')).toBe(true);
    expect(shouldFilterAdsOnClient('')).toBe(true);
  });

  it('缓存命名空间包含源站、策略和版本', () => {
    expect(getAdFilterCacheNamespace('rycj')).toBe(
      'rycj:rycj-periodic-blocks@1',
    );
    expect(getAdFilterCacheNamespace('ffzy')).toBe('ffzy:raw@1');
  });

  it('注册项拥有唯一策略标识', () => {
    const strategies = getRegisteredAdFilterSources().map((source) =>
      getSourceAdFilterStrategy(source),
    );
    const ids = strategies.map((strategy) => strategy?.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(strategies.every((strategy) => !!strategy?.version)).toBe(true);
  });
});
