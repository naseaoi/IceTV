export function createPrivateApiCacheHeaders(cacheTime: number): HeadersInit {
  return {
    'Cache-Control': `private, max-age=${cacheTime}`,
  };
}
