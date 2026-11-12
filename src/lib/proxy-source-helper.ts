import {
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';

type ProxySourceHelperConfig<T extends string> = {
  values: readonly T[];
  defaultValue: T;
  sourceStorageKey: string;
  proxyUrlStorageKey: string;
  readRuntimeSource: () => unknown;
  readRuntimeProxyUrl: () => string | undefined;
};

export function createProxySourceHelper<T extends string>({
  values,
  defaultValue,
  sourceStorageKey,
  proxyUrlStorageKey,
  readRuntimeSource,
  readRuntimeProxyUrl,
}: ProxySourceHelperConfig<T>) {
  function normalizeSource(value: unknown): T {
    return values.includes(value as T) ? (value as T) : defaultValue;
  }

  function readDefaultSource(): T {
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    return normalizeSource(readRuntimeSource());
  }

  function readSource(): T {
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    const savedSource = readStorage(sourceStorageKey);
    return savedSource === null
      ? readDefaultSource()
      : normalizeSource(savedSource);
  }

  function writeSource(value: unknown): boolean {
    const normalizedSource = normalizeSource(value);
    return writeStorage(sourceStorageKey, normalizedSource);
  }

  function resetSource(): boolean {
    return removeStorage(sourceStorageKey);
  }

  function readDefaultProxyUrl(): string {
    if (typeof window === 'undefined') {
      return '';
    }

    return readRuntimeProxyUrl() || '';
  }

  function readProxyUrl(): string {
    if (typeof window === 'undefined') {
      return '';
    }

    const savedProxyUrl = readStorage(proxyUrlStorageKey);
    return savedProxyUrl === null ? readDefaultProxyUrl() : savedProxyUrl;
  }

  function writeProxyUrl(value: string): boolean {
    return writeStorage(proxyUrlStorageKey, value);
  }

  function resetProxyUrl(): boolean {
    return removeStorage(proxyUrlStorageKey);
  }

  return {
    normalizeSource,
    readDefaultSource,
    readSource,
    writeSource,
    resetSource,
    readDefaultProxyUrl,
    readProxyUrl,
    writeProxyUrl,
    resetProxyUrl,
  };
}
