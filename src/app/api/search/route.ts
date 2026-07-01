import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { runSearchAggregation } from '@/lib/search-aggregate';
import {
  peekCachedSearchAggregate,
  refreshCachedSearchAggregate,
  setCachedSearchAggregate,
} from '@/lib/search-cache';

export const runtime = 'nodejs';

const SEARCH_SOURCE_CONCURRENCY = 6;

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      },
    );
  }

  const config = await getConfig();
  const cacheTime = getCacheTime(config);
  const apiSites = await getAvailableApiSites(guardResult.username, config);
  const maxSearchPages = config.SiteConfig.SearchDownstreamMaxPage;
  const aggregateCacheParams = {
    query,
    apiSites,
    maxSearchPages,
    disableYellowFilter: config.SiteConfig.DisableYellowFilter,
  };
  const cachedAggregate = peekCachedSearchAggregate(aggregateCacheParams);

  if (cachedAggregate) {
    if (!cachedAggregate.fresh) {
      void refreshCachedSearchAggregate(aggregateCacheParams, () =>
        runSearchAggregation({
          apiSites,
          query,
          maxSearchPages,
          disableYellowFilter: config.SiteConfig.DisableYellowFilter,
          sourceConcurrency: SEARCH_SOURCE_CONCURRENCY,
        }),
      ).catch(() => {});
    }

    return NextResponse.json(
      { results: cachedAggregate.entry.results },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      },
    );
  }

  try {
    const flattenedResults = await runSearchAggregation({
      apiSites,
      query,
      maxSearchPages,
      disableYellowFilter: config.SiteConfig.DisableYellowFilter,
      sourceConcurrency: SEARCH_SOURCE_CONCURRENCY,
      signal: request.signal,
    });
    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    setCachedSearchAggregate(aggregateCacheParams, flattenedResults);

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
