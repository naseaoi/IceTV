import { NextRequest } from 'next/server';

import { createSharedSearchStream } from '@/features/search/lib/search-stream.server';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getSearchSourceConcurrency } from '@/lib/cache-budget-profile';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { collectSearchAggregation } from '@/lib/search-aggregate';
import {
  peekCachedSearchAggregate,
  refreshCachedSearchAggregate,
} from '@/lib/search-cache';
import {
  type SearchFailedSource,
  describeFailedSearchSources,
} from '@/lib/search-failed-sources';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { getSourceHealthTiers } from '@/lib/source-health.server';
import { rankSourcesByHealth } from '@/lib/source-quality-policy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const retryParam = searchParams.get('retry');

  if (!query) {
    return new Response(JSON.stringify({ error: '搜索关键词不能为空' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });
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
  // 重试只搜上次失败的源；缓存键仍按完整源列表计算，便于把结果并回缓存
  const retrySources =
    retryParam === null ? null : new Set(retryParam.split(',').filter(Boolean));
  const targetSites = retrySources
    ? apiSites.filter((site) => retrySources.has(site.key))
    : apiSites;
  const cachedAggregate = retrySources
    ? null
    : peekCachedSearchAggregate(aggregateCacheParams);

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
        console.warn('流式搜索聚合后台刷新失败:', error);
      });
    }

    return createSearchStreamResponse(
      buildCachedSearchStream(
        query,
        apiSites.length,
        cachedAggregate.entry.results,
        describeFailedSearchSources(
          apiSites,
          cachedAggregate.entry.failedSources,
        ),
      ),
    );
  }

  try {
    return createSearchStreamResponse(
      createSharedSearchStream(
        {
          apiSites: targetSites,
          query,
          maxSearchPages,
          disableYellowFilter: config.SiteConfig.DisableYellowFilter,
          sourceConcurrency,
          sourceFailureCooldownMs,
          sourceTimeoutMs,
          sourceHealthTiers,
          retryFailed: retrySources !== null,
        },
        aggregateCacheParams,
        request.signal,
      ),
    );
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    throw error;
  }
}

function buildCachedSearchStream(
  query: string,
  totalSources: number,
  results: unknown[],
  failedSources: SearchFailedSource[],
): string {
  return [
    {
      type: 'start',
      query,
      totalSources,
      timestamp: Date.now(),
    },
    {
      type: 'source_result',
      source: 'aggregate-cache',
      sourceName: 'aggregate-cache',
      results,
      timestamp: Date.now(),
    },
    ...failedSources.map((site) => ({
      type: 'source_error',
      source: site.key,
      sourceName: site.name,
      error: '搜索失败',
      timestamp: Date.now(),
    })),
    {
      type: 'complete',
      totalResults: results.length,
      completedSources: totalSources,
      timestamp: Date.now(),
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
}

function createSearchStreamResponse(body: BodyInit) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Nginx 反代默认缓冲上游响应，事件会成批到达；此头让其逐条转发，部署者无需改反代配置
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
