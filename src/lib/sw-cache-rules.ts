type CacheNamedHandler = {
  cacheName?: string;
};

type RuntimeCacheEntry = {
  handler: unknown;
};

export function excludeDefaultApiRuntimeCache<T extends RuntimeCacheEntry>(
  entries: T[],
): T[] {
  return entries.filter((entry) => {
    const handler = entry.handler as CacheNamedHandler;
    return handler.cacheName !== 'apis';
  });
}
