import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getSearchSourceConcurrency } from '@/lib/cache-budget-profile';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { collectSearchAggregation } from '@/lib/search-aggregate';
import {
  loadCachedSearchAggregate,
  peekCachedSearchAggregate,
  refreshCachedSearchAggregate,
} from '@/lib/search-cache';
import { describeFailedSearchSources } from '@/lib/search-failed-sources';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { getSourceHealthTiers } from '@/lib/source-health.server';
import { rankSourcesByHealth } from '@/lib/source-quality-policy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json(
      { results: [] },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const config = await getConfigForRead();
  const runtimeParams = normalizeRuntimeParams(config.SiteConfig);
  const [availableSites, sourceHealthTiers] = await Promise.all([
    getAvailableApiSites(guardResult.username, config, guardResult.userAccess),
    getSourceHealthTiers(),
  ]);
  const apiSites = rankSourcesByHealth(availableSites, sourceHealthTiers);
  const maxSearchPages = runtimeParams.SearchDownstreamMaxPage;
  const sourceFailureCooldownMs =
    runtimeParams.SourceFailureCooldownSeconds * 1000;
  // 单源总预算覆盖首页 + 两轮额外分页
  const sourceTimeoutMs =
    runtimeParams.SearchRequestTimeoutSeconds * 1000 * 2.5;
  const sourceConcurrency = getSearchSourceConcurrency(
    runtimeParams.UpstreamSearchConcurrency,
  );
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
        collectSearchAggregation({
          apiSites,
          query,
          maxSearchPages,
          disableYellowFilter: config.SiteConfig.DisableYellowFilter,
          sourceConcurrency,
          sourceFailureCooldownMs,
          sourceTimeoutMs,
          sourceHealthTiers,
        }),
      ).catch((error) => {
        console.warn('搜索聚合后台刷新失败:', error);
      });
    }

    return NextResponse.json(
      {
        results: cachedAggregate.entry.results,
        totalSources: apiSites.length,
        failedSources: describeFailedSearchSources(
          apiSites,
          cachedAggregate.entry.failedSources,
        ),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const aggregate = await loadCachedSearchAggregate(
      aggregateCacheParams,
      () =>
        collectSearchAggregation({
          apiSites,
          query,
          maxSearchPages,
          disableYellowFilter: config.SiteConfig.DisableYellowFilter,
          sourceConcurrency,
          sourceFailureCooldownMs,
          sourceTimeoutMs,
          sourceHealthTiers,
        }),
    );
    return NextResponse.json(
      {
        results: aggregate.results,
        totalSources: apiSites.length,
        failedSources: describeFailedSearchSources(
          apiSites,
          aggregate.failedSources,
        ),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    console.error('搜索聚合失败:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
