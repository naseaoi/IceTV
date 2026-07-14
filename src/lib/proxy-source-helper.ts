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

    const savedSource = window.localStorage.getItem(sourceStorageKey);
    return savedSource === null
      ? readDefaultSource()
      : normalizeSource(savedSource);
  }

  function writeSource(value: unknown): T {
    const normalizedSource = normalizeSource(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(sourceStorageKey, normalizedSource);
    }
    return normalizedSource;
  }

  function resetSource(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(sourceStorageKey);
    }
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

    const savedProxyUrl = window.localStorage.getItem(proxyUrlStorageKey);
    return savedProxyUrl === null ? readDefaultProxyUrl() : savedProxyUrl;
  }

  function writeProxyUrl(value: string): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(proxyUrlStorageKey, value);
    }
  }

  function resetProxyUrl(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(proxyUrlStorageKey);
    }
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
