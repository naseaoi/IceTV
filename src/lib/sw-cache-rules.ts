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

export function shouldHandleNextImageCache(input: {
  pathname: string;
  search: string;
}): boolean {
  return /^\/_next\/image\?url=.+$/.test(input.pathname + input.search);
}

export function shouldHandleImageProxyCache(input: {
  pathname: string;
  search: string;
}): boolean {
  return /^\/api\/image-proxy\?url=.+$/.test(input.pathname + input.search);
}

export function shouldHandleBangumiCoverCache(input: {
  pathname: string;
}): boolean {
  return /^\/api\/bangumi-cover\/[lcmgs]\//i.test(input.pathname);
}

export function shouldHandleExternalCoverCache(input: {
  hostname: string;
}): boolean {
  return /^(lain\.bgm\.tv|img\d+\.doubanio\.com|img3\.doubanio\.com|img\.doubanio\.cmliussss\.(net|com))$/.test(
    input.hostname,
  );
}
