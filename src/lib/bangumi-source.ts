export const BANGUMI_DATA_SOURCE_STORAGE_KEY = 'bangumiDataSource';
export const BANGUMI_PROXY_URL_STORAGE_KEY = 'bangumiProxyUrl';

export const BANGUMI_DATA_SOURCE_VALUES = [
  'server',
  'direct',
  'custom',
] as const;

export type BangumiDataSource = (typeof BANGUMI_DATA_SOURCE_VALUES)[number];

export const DEFAULT_BANGUMI_DATA_SOURCE: BangumiDataSource = 'server';

export const bangumiDataSourceOptions: {
  value: BangumiDataSource;
  label: string;
}[] = [
  { value: 'direct', label: '直连（浏览器请求）' },
  {
    value: 'server',
    label: '代理（服务器请求）',
  },
  { value: 'custom', label: '自定义代理' },
];

export function readDefaultBangumiDataSource(): BangumiDataSource {
  if (typeof window === 'undefined') {
    return DEFAULT_BANGUMI_DATA_SOURCE;
  }

  return normalizeBangumiDataSource(window.RUNTIME_CONFIG?.BANGUMI_DATA_SOURCE);
}

export function normalizeBangumiDataSource(value: unknown): BangumiDataSource {
  return typeof value === 'string' &&
    BANGUMI_DATA_SOURCE_VALUES.includes(value as BangumiDataSource)
    ? (value as BangumiDataSource)
    : DEFAULT_BANGUMI_DATA_SOURCE;
}

export function readBangumiDataSource(): BangumiDataSource {
  if (typeof window === 'undefined') {
    return DEFAULT_BANGUMI_DATA_SOURCE;
  }

  const savedSource = window.localStorage.getItem(
    BANGUMI_DATA_SOURCE_STORAGE_KEY,
  );

  return savedSource === null
    ? readDefaultBangumiDataSource()
    : normalizeBangumiDataSource(savedSource);
}

export function readDefaultBangumiProxyUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.RUNTIME_CONFIG?.BANGUMI_PROXY || '';
}

export function readBangumiProxyUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const savedProxyUrl = window.localStorage.getItem(
    BANGUMI_PROXY_URL_STORAGE_KEY,
  );

  return savedProxyUrl === null ? readDefaultBangumiProxyUrl() : savedProxyUrl;
}
