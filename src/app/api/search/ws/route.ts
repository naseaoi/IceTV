import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { runSearchAggregation } from '@/lib/search-aggregate';
import {
  peekCachedSearchAggregate,
  refreshCachedSearchAggregate,
  setCachedSearchAggregate,
} from '@/lib/search-cache';
import { normalizeRuntimeParams } from '@/lib/runtime-params';

export const runtime = 'nodejs';

const SEARCH_SOURCE_CONCURRENCY = 6;

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

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
  const apiSites = await getAvailableApiSites(guardResult.username, config);
  const maxSearchPages = runtimeParams.SearchDownstreamMaxPage;
  const sourceFailureCooldownMs =
    runtimeParams.SourceFailureCooldownSeconds * 1000;
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
          sourceFailureCooldownMs,
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
        totalSources: apiSites.length,
        timestamp: Date.now(),
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        cleanupRequestSignal();
        return; // 连接已关闭，提前退出
      }

      // 记录已完成的源数量
      let completedSources = 0;
      const finalResults = await runSearchAggregation({
        apiSites,
        query,
        maxSearchPages,
        disableYellowFilter: config.SiteConfig.DisableYellowFilter,
        sourceConcurrency: SEARCH_SOURCE_CONCURRENCY,
        sourceFailureCooldownMs,
        signal: searchAbortController.signal,
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

          const errorEvent = `data: ${JSON.stringify({
            type: 'source_error',
            source: site.key,
            sourceName: site.name,
            error: error instanceof Error ? error.message : '搜索失败',
            timestamp: Date.now(),
          })}\n\n`;

          if (!safeEnqueue(encoder.encode(errorEvent))) {
            streamClosed = true;
          }
        },
      });

      if (!streamClosed) {
        if (finalResults.length > 0) {
          setCachedSearchAggregate(aggregateCacheParams, finalResults);
        }

        const completeEvent = `data: ${JSON.stringify({
          type: 'complete',
          totalResults: finalResults.length,
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
