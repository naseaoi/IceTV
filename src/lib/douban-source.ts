import { createProxySourceHelper } from '@/lib/proxy-source-helper';

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

const doubanProxySourceHelper = createProxySourceHelper({
  values: DOUBAN_PROXY_TYPE_VALUES,
  defaultValue: DEFAULT_DOUBAN_PROXY_TYPE,
  sourceStorageKey: DOUBAN_DATA_SOURCE_STORAGE_KEY,
  proxyUrlStorageKey: DOUBAN_PROXY_URL_STORAGE_KEY,
  readRuntimeSource: () => window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE,
  readRuntimeProxyUrl: () => window.RUNTIME_CONFIG?.DOUBAN_PROXY,
});

export function normalizeDoubanProxyType(value: unknown): DoubanProxyType {
  return doubanProxySourceHelper.normalizeSource(value);
}

export function readDefaultDoubanProxyType(): DoubanProxyType {
  return doubanProxySourceHelper.readDefaultSource();
}

export function readDoubanProxyType(): DoubanProxyType {
  return doubanProxySourceHelper.readSource();
}

export function readDefaultDoubanProxyUrl(): string {
  return doubanProxySourceHelper.readDefaultProxyUrl();
}

export function readDoubanProxyUrl(): string {
  return doubanProxySourceHelper.readProxyUrl();
}
