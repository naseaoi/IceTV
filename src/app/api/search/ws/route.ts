import { NextRequest } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getSearchSourceConcurrency } from '@/lib/cache-budget-profile';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { collectSearchAggregation } from '@/lib/search-aggregate';
import {
  mergeRetriedSearchAggregate,
  peekCachedSearchAggregate,
  refreshCachedSearchAggregate,
  setCachedSearchAggregate,
} from '@/lib/search-cache';
import {
  type SearchFailedSource,
  describeFailedSearchSources,
} from '@/lib/search-failed-sources';
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

  // 共享状态
  let streamClosed = false;
  const searchAbortController = new AbortController();

  const abortSearch = () => {
    if (!searchAbortController.signal.aborted) {
      searchAbortController.abort();
    }
  };

  const closeSearch = () => {
    streamClosed = true;
    abortSearch();
  };
  const cleanupRequestSignal = () => {
    request.signal.removeEventListener('abort', closeSearch);
  };

  if (request.signal.aborted) {
    closeSearch();
  } else {
    request.signal.addEventListener('abort', closeSearch, { once: true });
  }

  // 创建可读流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 辅助函数：安全地向控制器写入数据
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (
            streamClosed ||
            (!controller.desiredSize && controller.desiredSize !== 0)
          ) {
            // 流已标记为关闭或控制器已关闭
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          // 控制器已关闭或出现其他错误
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          abortSearch();
          return false;
        }
      };

      // 发送开始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        totalSources: targetSites.length,
        timestamp: Date.now(),
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        cleanupRequestSignal();
        return; // 连接已关闭，提前退出
      }

      // 记录已完成的源数量
      let completedSources = 0;
      const aggregate = await collectSearchAggregation({
        apiSites: targetSites,
        query,
        maxSearchPages,
        disableYellowFilter: config.SiteConfig.DisableYellowFilter,
        sourceConcurrency,
        sourceFailureCooldownMs,
        sourceTimeoutMs,
        sourceHealthTiers,
        signal: searchAbortController.signal,
        retryFailed: retrySources !== null,
        shouldContinue: () =>
          !streamClosed && !searchAbortController.signal.aborted,
        onSourceResult: (site, results) => {
          completedSources++;

          if (streamClosed) {
            return;
          }

          const sourceEvent = `data: ${JSON.stringify({
            type: 'source_result',
            source: site.key,
            sourceName: site.name,
            results,
            timestamp: Date.now(),
          })}\n\n`;

          if (!safeEnqueue(encoder.encode(sourceEvent))) {
            streamClosed = true;
          }
        },
        onSourceError: (site, error) => {
          completedSources++;

          if (streamClosed) {
            return;
          }

          console.error('流式搜索源请求失败:', site.key, error);
          const errorEvent = `data: ${JSON.stringify({
            type: 'source_error',
            source: site.key,
            sourceName: site.name,
            error: '搜索失败',
            timestamp: Date.now(),
          })}\n\n`;

          if (!safeEnqueue(encoder.encode(errorEvent))) {
            streamClosed = true;
          }
        },
      });

      if (!streamClosed) {
        if (retrySources) {
          mergeRetriedSearchAggregate(
            aggregateCacheParams,
            new Set(targetSites.map((site) => site.key)),
            aggregate,
          );
        } else {
          setCachedSearchAggregate(aggregateCacheParams, aggregate);
        }

        const completeEvent = `data: ${JSON.stringify({
          type: 'complete',
          totalResults: aggregate.results.length,
          completedSources,
          timestamp: Date.now(),
        })}\n\n`;

        if (safeEnqueue(encoder.encode(completeEvent))) {
          try {
            controller.close();
          } catch (error) {
            console.warn('Failed to close controller:', error);
          }
        }
      }

      cleanupRequestSignal();
    },

    cancel() {
      // 客户端断开连接时，标记流已关闭
      closeSearch();
      cleanupRequestSignal();
      console.log('Client disconnected, cancelling search stream');
    },
  });

  // 返回流式响应
  return createSearchStreamResponse(stream);
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
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
