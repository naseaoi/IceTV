// 服务端内存缓存的档位预算。small 面向 1c1t / 1GB 小鸡，standard 面向 2C4G 以上
export type CacheProfileName = 'small' | 'standard';

export type ServerCacheName =
  | 'search-pages'
  | 'search-empty-pages'
  | 'search-aggregates'
  | 'detail'
  | 'cover-image-resize'
  | 'proxy-m3u8'
  | 'proxy-m3u8-rewrite'
  | 'douban-route'
  | 'douban-recommends'
  | 'episode-url'
  | 'danmaku-comments'
  | 'danmaku-search';

export interface ServerCacheBudget {
  maxSize: number;
  maxWeightBytes: number;
}

const MB = 1024 * 1024;

const SMALL_PROFILE: Record<ServerCacheName, ServerCacheBudget> = {
  'search-pages': { maxSize: 400, maxWeightBytes: 12 * MB },
  'search-empty-pages': { maxSize: 250, maxWeightBytes: 2 * MB },
  'search-aggregates': { maxSize: 80, maxWeightBytes: 12 * MB },
  detail: { maxSize: 800, maxWeightBytes: 16 * MB },
  'cover-image-resize': { maxSize: 400, maxWeightBytes: 16 * MB },
  'proxy-m3u8': { maxSize: 200, maxWeightBytes: 8 * MB },
  'proxy-m3u8-rewrite': { maxSize: 100, maxWeightBytes: 4 * MB },
  'douban-route': { maxSize: 300, maxWeightBytes: 6 * MB },
  'douban-recommends': { maxSize: 300, maxWeightBytes: 6 * MB },
  'episode-url': { maxSize: 2000, maxWeightBytes: 4 * MB },
  'danmaku-comments': { maxSize: 40, maxWeightBytes: 12 * MB },
  'danmaku-search': { maxSize: 200, maxWeightBytes: 2 * MB },
};

const STANDARD_PROFILE: Record<ServerCacheName, ServerCacheBudget> = {
  'search-pages': { maxSize: 1000, maxWeightBytes: 32 * MB },
  'search-empty-pages': { maxSize: 250, maxWeightBytes: 2 * MB },
  'search-aggregates': { maxSize: 200, maxWeightBytes: 48 * MB },
  detail: { maxSize: 2000, maxWeightBytes: 48 * MB },
  'cover-image-resize': { maxSize: 1200, maxWeightBytes: 48 * MB },
  'proxy-m3u8': { maxSize: 500, maxWeightBytes: 32 * MB },
  'proxy-m3u8-rewrite': { maxSize: 200, maxWeightBytes: 16 * MB },
  'douban-route': { maxSize: 500, maxWeightBytes: 16 * MB },
  'douban-recommends': { maxSize: 500, maxWeightBytes: 16 * MB },
  'episode-url': { maxSize: 5000, maxWeightBytes: 8 * MB },
  'danmaku-comments': { maxSize: 120, maxWeightBytes: 40 * MB },
  'danmaku-search': { maxSize: 500, maxWeightBytes: 6 * MB },
};

const PROFILES: Record<
  CacheProfileName,
  Record<ServerCacheName, ServerCacheBudget>
> = {
  small: SMALL_PROFILE,
  standard: STANDARD_PROFILE,
};

export const DEFAULT_CACHE_PROFILE: CacheProfileName = 'small';

export function resolveCacheProfileName(
  raw = process.env.CACHE_PROFILE,
): CacheProfileName {
  const normalized = raw?.trim().toLowerCase();
  return normalized === 'standard' || normalized === 'small'
    ? normalized
    : DEFAULT_CACHE_PROFILE;
}

export function getServerCacheBudget(
  cache: ServerCacheName,
  profile = resolveCacheProfileName(),
): ServerCacheBudget {
  return PROFILES[profile][cache];
}

// 跨请求共享的上游搜索并发上限。单次搜索内部并发不受此限制影响，多人同时搜索时排队
const UPSTREAM_SEARCH_CONCURRENCY: Record<CacheProfileName, number> = {
  small: 12,
  standard: 24,
};

// 优先级：后台配置 > 环境变量 > 档位默认值
export function getUpstreamSearchConcurrency(
  configuredLimit = 0,
  profile = resolveCacheProfileName(),
): number {
  if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
    return Math.floor(configuredLimit);
  }
  const override = Number.parseInt(
    process.env.UPSTREAM_SEARCH_CONCURRENCY || '',
    10,
  );
  if (Number.isFinite(override) && override > 0) {
    return override;
  }
  return UPSTREAM_SEARCH_CONCURRENCY[profile];
}

// 单次搜索的源并发。与闸门齐平：一人搜索时吃满额度，多人时由闸门排队
export function getSearchSourceConcurrency(
  configuredLimit = 0,
  profile = resolveCacheProfileName(),
): number {
  return getUpstreamSearchConcurrency(configuredLimit, profile);
}

export function getProfileTotalBytes(
  profile = resolveCacheProfileName(),
): number {
  return Object.values(PROFILES[profile]).reduce(
    (total, budget) => total + budget.maxWeightBytes,
    0,
  );
}
