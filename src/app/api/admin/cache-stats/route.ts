import { NextRequest, NextResponse } from 'next/server';

import { getDoubanRouteCacheStats } from '@/app/api/douban/cache';
import { getDoubanRecommendsCacheStats } from '@/app/api/douban/recommends/cache';
import { getEpisodeUrlCacheStats } from '@/app/api/episode-url/cache';
import { getM3U8CacheStats } from '@/app/api/proxy/m3u8/service';
import { getM3U8RewriteCacheStats } from '@/features/play/lib/m3u8-rewrite';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import {
  getProfileTotalBytes,
  getUpstreamSearchConcurrency,
  resolveCacheProfileName,
} from '@/lib/cache-budget-profile';
import { getConfigForRead } from '@/lib/config';
import { getResizedCoverCacheStats } from '@/lib/cover-image-resize-cache.server';
import { getDetailCacheStats } from '@/lib/detail-cache';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { getUpstreamSearchGateStats } from '@/lib/search-aggregate';
import { getSearchCacheStats } from '@/lib/search-cache';
import type { SwrCacheStats } from '@/lib/server-cache';

export const runtime = 'nodejs';

function withHitRate(name: string, stats: SwrCacheStats) {
  const lookups = stats.hits + stats.misses;
  return {
    name,
    ...stats,
    hitRate: lookups > 0 ? Number((stats.hits / lookups).toFixed(4)) : null,
  };
}

export async function GET(request: NextRequest) {
  const guardResult = await requireAdmin(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const config = await getConfigForRead();
  const runtimeParams = normalizeRuntimeParams(config.SiteConfig);
  const searchStats = getSearchCacheStats();
  const caches = [
    withHitRate('search-pages', searchStats.pages),
    withHitRate('search-empty-pages', searchStats.emptyPages),
    withHitRate('search-aggregates', searchStats.aggregates),
    withHitRate('detail', getDetailCacheStats()),
    withHitRate('cover-image-resize', getResizedCoverCacheStats()),
    withHitRate('proxy-m3u8', getM3U8CacheStats()),
    withHitRate('proxy-m3u8-rewrite', getM3U8RewriteCacheStats()),
    withHitRate('douban-route', getDoubanRouteCacheStats()),
    withHitRate('douban-recommends', getDoubanRecommendsCacheStats()),
    withHitRate('episode-url', getEpisodeUrlCacheStats()),
  ];

  return NextResponse.json(
    {
      profile: resolveCacheProfileName(),
      budgetTotalBytes: getProfileTotalBytes(),
      usedBytes: caches.reduce(
        (total, cache) => total + cache.estimatedBytes,
        0,
      ),
      upstreamSearch: {
        ...getUpstreamSearchGateStats(),
        configuredLimit: getUpstreamSearchConcurrency(
          runtimeParams.UpstreamSearchConcurrency,
        ),
      },
      memoryUsage: process.memoryUsage(),
      caches,
    },
    { headers: NO_STORE_HEADERS },
  );
}
