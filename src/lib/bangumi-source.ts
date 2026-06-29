export const BANGUMI_DATA_SOURCE_STORAGE_KEY = 'bangumiDataSource';

export const BANGUMI_DATA_SOURCE_VALUES = ['server', 'direct'] as const;

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
