import {
  DEFAULT_DOUBAN_PROXY_TYPE,
  DOUBAN_DATA_SOURCE_STORAGE_KEY,
  DOUBAN_PROXY_URL_STORAGE_KEY,
  normalizeDoubanProxyType,
  readDoubanProxyType,
  readDoubanProxyUrl,
} from '../douban-source';

describe('normalizeDoubanProxyType', () => {
  it('keeps supported values', () => {
    expect(normalizeDoubanProxyType('server')).toBe('server');
    expect(normalizeDoubanProxyType('cmliussss-cdn-tencent')).toBe(
      'cmliussss-cdn-tencent',
    );
  });

  it('falls back for unsupported values', () => {
    expect(normalizeDoubanProxyType('auto')).toBe(DEFAULT_DOUBAN_PROXY_TYPE);
    expect(normalizeDoubanProxyType(null)).toBe(DEFAULT_DOUBAN_PROXY_TYPE);
  });
});

describe('readDoubanProxyType', () => {
  beforeEach(() => {
    localStorage.removeItem(DOUBAN_DATA_SOURCE_STORAGE_KEY);
    localStorage.removeItem(DOUBAN_PROXY_URL_STORAGE_KEY);
    delete window.RUNTIME_CONFIG;
  });

  it('uses runtime config by default', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_PROXY_TYPE: 'server',
    } as typeof window.RUNTIME_CONFIG;

    expect(readDoubanProxyType()).toBe('server');
  });

  it('uses local storage before runtime config', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_PROXY_TYPE: 'server',
    } as typeof window.RUNTIME_CONFIG;
    localStorage.setItem(DOUBAN_DATA_SOURCE_STORAGE_KEY, 'custom');

    expect(readDoubanProxyType()).toBe('custom');
  });

  it('uses local proxy url before runtime config', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_PROXY: 'https://runtime.example/fetch?url=',
    } as typeof window.RUNTIME_CONFIG;
    localStorage.setItem(
      DOUBAN_PROXY_URL_STORAGE_KEY,
      'https://local.example/fetch?url=',
    );

    expect(readDoubanProxyUrl()).toBe('https://local.example/fetch?url=');
  });
});
