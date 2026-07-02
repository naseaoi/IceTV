export const DOUBAN_DATA_SOURCE_STORAGE_KEY = 'doubanDataSource';
export const DOUBAN_PROXY_URL_STORAGE_KEY = 'doubanProxyUrl';

export const DOUBAN_PROXY_TYPE_VALUES = [
  'direct',
  'server',
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
  'cors-anywhere',
  'custom',
] as const;

export type DoubanProxyType = (typeof DOUBAN_PROXY_TYPE_VALUES)[number];

export const DEFAULT_DOUBAN_PROXY_TYPE: DoubanProxyType = 'direct';

export function normalizeDoubanProxyType(value: unknown): DoubanProxyType {
  return DOUBAN_PROXY_TYPE_VALUES.includes(value as DoubanProxyType)
    ? (value as DoubanProxyType)
    : DEFAULT_DOUBAN_PROXY_TYPE;
}

export function readDefaultDoubanProxyType(): DoubanProxyType {
  if (typeof window === 'undefined') {
    return DEFAULT_DOUBAN_PROXY_TYPE;
  }

  return normalizeDoubanProxyType(window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE);
}

export function readDoubanProxyType(): DoubanProxyType {
  if (typeof window === 'undefined') {
    return DEFAULT_DOUBAN_PROXY_TYPE;
  }

  const savedSource = window.localStorage.getItem(
    DOUBAN_DATA_SOURCE_STORAGE_KEY,
  );
  return savedSource === null
    ? readDefaultDoubanProxyType()
    : normalizeDoubanProxyType(savedSource);
}

export function readDefaultDoubanProxyUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.RUNTIME_CONFIG?.DOUBAN_PROXY || '';
}

export function readDoubanProxyUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const savedProxyUrl = window.localStorage.getItem(
    DOUBAN_PROXY_URL_STORAGE_KEY,
  );
  return savedProxyUrl === null ? readDefaultDoubanProxyUrl() : savedProxyUrl;
}
