// 每次改写清单都会给同一分片签发新的签名和切换标记，缓存键必须剔除这些参数才能跨清单命中
const VOLATILE_SEGMENT_PARAMS = new Set([
  'icetv-expires',
  'icetv-signature',
  'icetv-switch',
  'icetv-user-switch',
]);

export function normalizeSegmentCacheKey(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const pairs = url.search.slice(1).split('&');
  if (!pairs.some(isVolatileSegmentParam)) {
    return rawUrl;
  }

  // 按原始片段过滤而不经 URLSearchParams 重新序列化，其余参数保持原编码，有无易变参数时得到同一个键
  const kept = pairs.filter((pair) => pair && !isVolatileSegmentParam(pair));
  url.search = kept.length > 0 ? `?${kept.join('&')}` : '';
  url.hash = '';
  return url.toString();
}

function isVolatileSegmentParam(pair: string): boolean {
  return VOLATILE_SEGMENT_PARAMS.has(pair.split('=', 1)[0]);
}
