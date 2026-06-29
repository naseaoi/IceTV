import {
  BANGUMI_DATA_SOURCE_STORAGE_KEY,
  DEFAULT_BANGUMI_DATA_SOURCE,
  normalizeBangumiDataSource,
  readBangumiDataSource,
} from '../bangumi-source';

describe('normalizeBangumiDataSource', () => {
  it('keeps supported Bangumi data sources', () => {
    expect(normalizeBangumiDataSource('direct')).toBe('direct');
    expect(normalizeBangumiDataSource('server')).toBe('server');
  });

  it('uses default source for unsupported values', () => {
    expect(normalizeBangumiDataSource('auto')).toBe(
      DEFAULT_BANGUMI_DATA_SOURCE,
    );
    expect(normalizeBangumiDataSource('custom')).toBe(
      DEFAULT_BANGUMI_DATA_SOURCE,
    );
    expect(normalizeBangumiDataSource('bangumi-cmliussss')).toBe(
      DEFAULT_BANGUMI_DATA_SOURCE,
    );
    expect(normalizeBangumiDataSource(null)).toBe(DEFAULT_BANGUMI_DATA_SOURCE);
  });
});

describe('readBangumiDataSource', () => {
  afterEach(() => {
    localStorage.removeItem(BANGUMI_DATA_SOURCE_STORAGE_KEY);
    delete window.RUNTIME_CONFIG;
  });

  it('uses runtime default when local source is not set', () => {
    window.RUNTIME_CONFIG = {
      BANGUMI_DATA_SOURCE: 'direct',
    } as typeof window.RUNTIME_CONFIG;

    expect(readBangumiDataSource()).toBe('direct');
  });

  it('uses local source before runtime default', () => {
    window.RUNTIME_CONFIG = {
      BANGUMI_DATA_SOURCE: 'direct',
    } as typeof window.RUNTIME_CONFIG;
    localStorage.setItem(BANGUMI_DATA_SOURCE_STORAGE_KEY, 'server');

    expect(readBangumiDataSource()).toBe('server');
  });
});
