import { NextRequest, NextResponse } from 'next/server';

import { validateSourceSearch } from '@/features/admin/lib/source-search-validation.server';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { runWithConcurrency } from '@/lib/concurrency';
import { getConfigForRead } from '@/lib/config';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import {
  type SourceSearchOutcome,
  flushSourceHealthSearch,
  recordSourceSearchOutcome,
} from '@/lib/source-health.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireAdmin(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const searchKeyword = searchParams.get('q')?.trim();
  const sourceKey = searchParams.get('source')?.trim();
  const sourceKeys = (searchParams.get('sources') || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  if (!searchKeyword) {
    return new Response(JSON.stringify({ error: '搜索关键词不能为空' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  const config = await getConfigForRead();
  const sourceKeySet =
    sourceKeys.length > 0
      ? new Set(sourceKeys)
      : sourceKey
        ? new Set([sourceKey])
        : null;
  const apiSites = sourceKeySet
    ? config.SourceConfig.filter((site) => sourceKeySet.has(site.key))
    : config.SourceConfig;

  if (sourceKeySet && apiSites.length !== sourceKeySet.size) {
    return NextResponse.json({ error: '源不存在' }, { status: 404 });
  }

  // 共享状态
  let streamClosed = false;
  const upstreamController = new AbortController();
  const cancelUpstream = () => {
    streamClosed = true;
    upstreamController.abort();
  };
  request.signal.addEventListener('abort', cancelUpstream, { once: true });
  if (request.signal.aborted) cancelUpstream();

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
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          console.warn('Failed to enqueue data:', error);
          cancelUpstream();
          return false;
        }
      };

      // 发送开始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        totalSources: apiSites.length,
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        request.signal.removeEventListener('abort', cancelUpstream);
        return;
      }

      // 记录已完成的源数量
      let completedSources = 0;

      // 为每个源创建验证 Promise
      const validationTasks = apiSites.map((site) => async () => {
        if (upstreamController.signal.aborted) return;
        const abortState = createTimedAbortController(
          upstreamController.signal,
          10000,
        );
        const startedAt = Date.now();
        let outcome: SourceSearchOutcome = 'error';
        let resourceLimited = false;
        try {
          const status = await validateSourceSearch(
            site,
            searchKeyword,
            abortState.signal,
          );
          outcome = status === 'valid' ? 'ok' : 'empty';

          // 发送该源的验证结果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              status,
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return;
            }
          }
        } catch (error) {
          resourceLimited = error instanceof ResourceLimitError;
          console.warn(`验证失败 ${site.name}:`, error);

          // 发送源错误事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              status: 'invalid',
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        } finally {
          abortState.cleanup();
          const abortedByParent =
            upstreamController.signal.aborted && !abortState.isTimeout();
          if (!resourceLimited && !abortedByParent) {
            recordSourceSearchOutcome(
              site.key,
              outcome,
              Date.now() - startedAt,
            );
          }
        }
      });

      try {
        await runWithConcurrency(validationTasks, 3, () => !streamClosed);
        try {
          await flushSourceHealthSearch();
        } catch (error) {
          console.warn('刷新源健康数据失败:', error);
        }
        if (!streamClosed) {
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
            completedSources,
          })}\n\n`;
          if (safeEnqueue(encoder.encode(completeEvent))) {
            controller.close();
            streamClosed = true;
          }
        }
      } finally {
        request.signal.removeEventListener('abort', cancelUpstream);
      }
    },

    cancel() {
      cancelUpstream();
      request.signal.removeEventListener('abort', cancelUpstream);
    },
  });

  // 返回流式响应
  return new Response(stream, {
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
