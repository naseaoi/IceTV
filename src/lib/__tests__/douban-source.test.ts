import {
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DEFAULT_DOUBAN_PROXY_TYPE,
  DOUBAN_DATA_SOURCE_STORAGE_KEY,
  DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
  DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY,
  DOUBAN_PROXY_URL_STORAGE_KEY,
  normalizeDoubanImageProxyType,
  normalizeDoubanProxyType,
  readDoubanImageProxyType,
  readDoubanImageProxyUrl,
  readDoubanProxyType,
  readDoubanProxyUrl,
  resetDoubanImageProxyType,
  resetDoubanImageProxyUrl,
  resetDoubanProxyType,
  resetDoubanProxyUrl,
  writeDoubanImageProxyType,
  writeDoubanImageProxyUrl,
  writeDoubanProxyType,
  writeDoubanProxyUrl,
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
    localStorage.removeItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY);
    localStorage.removeItem(DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY);
    delete window.RUNTIME_CONFIG;
  });

  it('uses runtime config by default', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_PROXY_TYPE: 'server',
    } as typeof window.RUNTIME_CONFIG;

    expect(readDoubanProxyType()).toBe('server');
  });

  it('uses runtime image proxy config by default', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_IMAGE_PROXY_TYPE: 'cmliussss-cdn-ali',
    } as typeof window.RUNTIME_CONFIG;

    expect(readDoubanImageProxyType()).toBe('cmliussss-cdn-ali');
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

  it('falls back for removed image proxy types', () => {
    expect(normalizeDoubanImageProxyType('img3')).toBe(
      DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
    );

    localStorage.setItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY, 'img3');

    expect(readDoubanImageProxyType()).toBe(DEFAULT_DOUBAN_IMAGE_PROXY_TYPE);
  });

  it('keeps image proxy url separate from data proxy url', () => {
    localStorage.setItem(DOUBAN_PROXY_URL_STORAGE_KEY, 'https://data.example/');
    localStorage.setItem(
      DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY,
      'https://image.example/',
    );

    expect(readDoubanProxyUrl()).toBe('https://data.example/');
    expect(readDoubanImageProxyUrl()).toBe('https://image.example/');
  });

  it('writes normalized values and resets local overrides', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_PROXY_TYPE: 'server',
      DOUBAN_PROXY: 'https://runtime.example/data?url=',
      DOUBAN_IMAGE_PROXY_TYPE: 'cmliussss-cdn-ali',
    } as typeof window.RUNTIME_CONFIG;

    expect(writeDoubanProxyType('unsupported')).toBe('direct');
    expect(writeDoubanImageProxyType('unsupported')).toBe('direct');
    writeDoubanProxyUrl('https://local.example/data?url=');
    writeDoubanImageProxyUrl('https://local.example/image?url=');

    expect(readDoubanProxyUrl()).toBe('https://local.example/data?url=');
    expect(readDoubanImageProxyUrl()).toBe('https://local.example/image?url=');

    resetDoubanProxyType();
    resetDoubanProxyUrl();
    resetDoubanImageProxyType();
    resetDoubanImageProxyUrl();
    expect(readDoubanProxyType()).toBe('server');
    expect(readDoubanProxyUrl()).toBe('https://runtime.example/data?url=');
    expect(readDoubanImageProxyType()).toBe('cmliussss-cdn-ali');
  });
});
