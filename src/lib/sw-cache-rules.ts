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

export function shouldHandleVodSegmentCache(input: {
  sameOrigin: boolean;
  method: string;
  pathname: string;
  liveFlag: string | null;
  hasRangeHeader: boolean;
}): boolean {
  return (
    input.sameOrigin &&
    input.method === 'GET' &&
    input.pathname === '/api/proxy/segment' &&
    input.liveFlag !== '1' &&
    !input.hasRangeHeader
  );
}
