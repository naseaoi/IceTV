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

  return {
    normalizeSource,
    readDefaultSource,
    readSource,
    readDefaultProxyUrl,
    readProxyUrl,
  };
}
