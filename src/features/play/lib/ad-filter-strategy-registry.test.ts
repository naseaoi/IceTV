import {
  getRegisteredAdFilterSources,
  getSourceAdFilterStrategy,
} from '@/features/play/lib/ad-filter-strategy-registry';

describe('ad-filter-strategy-registry', () => {
  it('如意资源使用独立文本策略', () => {
    expect(getSourceAdFilterStrategy('rycj')).toMatchObject({
      id: 'rycj-periodic-blocks',
      timeline: 'continuous-periodic',
      signals: ['known-ad-templates', 'frame-grid-clips', 'host-anomaly'],
    });
    expect(getSourceAdFilterStrategy(' RYCJ ')).toBe(
      getSourceAdFilterStrategy('rycj'),
    );
  });

  it('未注册源使用通用规则', () => {
    for (const source of ['ffzy', '', null, undefined]) {
      expect(getSourceAdFilterStrategy(source)).toBeNull();
    }
  });

  it('注册项拥有唯一策略标识', () => {
    const ids = getRegisteredAdFilterSources().map(
      (source) => getSourceAdFilterStrategy(source)?.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
