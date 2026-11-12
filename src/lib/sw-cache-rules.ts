type CacheNamedHandler = {
  cacheName?: string;
};

type RuntimeCacheEntry = {
  handler: unknown;
};

// Serwist 按数组顺序取第一条匹配的规则，默认规则末尾的 /.*/ NetworkOnly 会接走所有同源请求，
// 自定义规则必须排在默认规则之前才会生效
export function composeRuntimeCaching<T extends RuntimeCacheEntry>(
  customEntries: T[],
  defaultEntries: T[],
): T[] {
  return [
    ...customEntries,
    ...defaultEntries.filter((entry) => {
      const handler = entry.handler as CacheNamedHandler;
      return handler.cacheName !== 'apis';
    }),
  ];
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

// 跨域图片多为不透明响应，Chrome 按每条约 7MB 计入配额；只走网络，复用浏览器 HTTP 缓存
export function shouldBypassCrossOriginImageCache(input: {
  sameOrigin: boolean;
  destination: string;
}): boolean {
  return !input.sameOrigin && input.destination === 'image';
}
