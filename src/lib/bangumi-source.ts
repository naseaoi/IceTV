import { createProxySourceHelper } from '@/lib/proxy-source-helper';

export const BANGUMI_DATA_SOURCE_STORAGE_KEY = 'bangumiDataSource';
export const BANGUMI_PROXY_URL_STORAGE_KEY = 'bangumiProxyUrl';

export const BANGUMI_DATA_SOURCE_VALUES = [
  'server',
  'direct',
  'custom',
] as const;

export type BangumiDataSource = (typeof BANGUMI_DATA_SOURCE_VALUES)[number];

export const DEFAULT_BANGUMI_DATA_SOURCE: BangumiDataSource = 'direct';

const bangumiProxySourceHelper = createProxySourceHelper({
  values: BANGUMI_DATA_SOURCE_VALUES,
  defaultValue: DEFAULT_BANGUMI_DATA_SOURCE,
  sourceStorageKey: BANGUMI_DATA_SOURCE_STORAGE_KEY,
  proxyUrlStorageKey: BANGUMI_PROXY_URL_STORAGE_KEY,
  readRuntimeSource: () => window.RUNTIME_CONFIG?.BANGUMI_DATA_SOURCE,
  readRuntimeProxyUrl: () => window.RUNTIME_CONFIG?.BANGUMI_PROXY,
});

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

export const siteBangumiDataSourceOptions = bangumiDataSourceOptions.filter(
  (option) => option.value !== 'custom',
);

export function normalizeSiteBangumiDataSource(
  value: unknown,
): BangumiDataSource {
  return siteBangumiDataSourceOptions.some((option) => option.value === value)
    ? (value as BangumiDataSource)
    : DEFAULT_BANGUMI_DATA_SOURCE;
}

export function readDefaultBangumiDataSource(): BangumiDataSource {
  return bangumiProxySourceHelper.readDefaultSource();
}

export function normalizeBangumiDataSource(value: unknown): BangumiDataSource {
  return bangumiProxySourceHelper.normalizeSource(value);
}

export function readBangumiDataSource(): BangumiDataSource {
  return bangumiProxySourceHelper.readSource();
}

export function writeBangumiDataSource(value: unknown): BangumiDataSource {
  return bangumiProxySourceHelper.writeSource(value);
}

export function resetBangumiDataSource(): void {
  bangumiProxySourceHelper.resetSource();
}

export function readDefaultBangumiProxyUrl(): string {
  return bangumiProxySourceHelper.readDefaultProxyUrl();
}

export function readBangumiProxyUrl(): string {
  return bangumiProxySourceHelper.readProxyUrl();
}

export function writeBangumiProxyUrl(value: string): void {
  bangumiProxySourceHelper.writeProxyUrl(value);
}

export function resetBangumiProxyUrl(): void {
  bangumiProxySourceHelper.resetProxyUrl();
}
