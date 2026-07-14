import { createProxySourceHelper } from '@/lib/proxy-source-helper';

export const DOUBAN_DATA_SOURCE_STORAGE_KEY = 'doubanDataSource';
export const DOUBAN_PROXY_URL_STORAGE_KEY = 'doubanProxyUrl';
export const DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY = 'doubanImageProxyType';
export const DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY = 'doubanImageProxyUrl';

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

export const DOUBAN_IMAGE_PROXY_TYPE_VALUES = [
  'direct',
  'server',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
  'custom',
] as const;

export type DoubanImageProxyType =
  (typeof DOUBAN_IMAGE_PROXY_TYPE_VALUES)[number];

export const DEFAULT_DOUBAN_IMAGE_PROXY_TYPE: DoubanImageProxyType = 'direct';

const doubanProxySourceHelper = createProxySourceHelper({
  values: DOUBAN_PROXY_TYPE_VALUES,
  defaultValue: DEFAULT_DOUBAN_PROXY_TYPE,
  sourceStorageKey: DOUBAN_DATA_SOURCE_STORAGE_KEY,
  proxyUrlStorageKey: DOUBAN_PROXY_URL_STORAGE_KEY,
  readRuntimeSource: () => window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE,
  readRuntimeProxyUrl: () => window.RUNTIME_CONFIG?.DOUBAN_PROXY,
});

const doubanImageProxySourceHelper = createProxySourceHelper({
  values: DOUBAN_IMAGE_PROXY_TYPE_VALUES,
  defaultValue: DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  sourceStorageKey: DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
  proxyUrlStorageKey: DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY,
  readRuntimeSource: () => window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE,
  readRuntimeProxyUrl: () => window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY,
});

export function normalizeDoubanProxyType(value: unknown): DoubanProxyType {
  return doubanProxySourceHelper.normalizeSource(value);
}

export function normalizeDoubanImageProxyType(
  value: unknown,
): DoubanImageProxyType {
  return doubanImageProxySourceHelper.normalizeSource(value);
}

export function readDefaultDoubanProxyType(): DoubanProxyType {
  return doubanProxySourceHelper.readDefaultSource();
}

export function readDoubanProxyType(): DoubanProxyType {
  return doubanProxySourceHelper.readSource();
}

export function writeDoubanProxyType(value: unknown): DoubanProxyType {
  return doubanProxySourceHelper.writeSource(value);
}

export function resetDoubanProxyType(): void {
  doubanProxySourceHelper.resetSource();
}

export function readDefaultDoubanProxyUrl(): string {
  return doubanProxySourceHelper.readDefaultProxyUrl();
}

export function readDoubanProxyUrl(): string {
  return doubanProxySourceHelper.readProxyUrl();
}

export function writeDoubanProxyUrl(value: string): void {
  doubanProxySourceHelper.writeProxyUrl(value);
}

export function resetDoubanProxyUrl(): void {
  doubanProxySourceHelper.resetProxyUrl();
}

export function readDefaultDoubanImageProxyType(): DoubanImageProxyType {
  return doubanImageProxySourceHelper.readDefaultSource();
}

export function readDoubanImageProxyType(): DoubanImageProxyType {
  return doubanImageProxySourceHelper.readSource();
}

export function writeDoubanImageProxyType(
  value: unknown,
): DoubanImageProxyType {
  return doubanImageProxySourceHelper.writeSource(value);
}

export function resetDoubanImageProxyType(): void {
  doubanImageProxySourceHelper.resetSource();
}

export function readDefaultDoubanImageProxyUrl(): string {
  return doubanImageProxySourceHelper.readDefaultProxyUrl();
}

export function readDoubanImageProxyUrl(): string {
  return doubanImageProxySourceHelper.readProxyUrl();
}

export function writeDoubanImageProxyUrl(value: string): void {
  doubanImageProxySourceHelper.writeProxyUrl(value);
}

export function resetDoubanImageProxyUrl(): void {
  doubanImageProxySourceHelper.resetProxyUrl();
}
