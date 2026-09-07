import { NextRequest, NextResponse } from 'next/server';

import { getCachedDanmakuComments } from '@/features/play/lib/danmaku/cache.server';
import { isDanmakuProviderConfigured } from '@/features/play/lib/danmaku/provider.server';
import { danmakuRateLimitResponse } from '@/features/play/lib/danmaku/rate-limit-response.server';
import { DanmakuProviderError } from '@/features/play/lib/danmaku/types';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import { resourceLimitResponse } from '@/lib/server-resource-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const config = await getConfigForRead();
  if (!config.SiteConfig.EnableDanmaku) {
    return NextResponse.json(
      { error: '弹幕功能未开启' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (!isDanmakuProviderConfigured()) {
    return NextResponse.json(
      { error: '弹幕服务未配置' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const episodeId = Number(request.nextUrl.searchParams.get('episodeId'));
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    return NextResponse.json(
      { error: 'episodeId 无效' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const keyword = (request.nextUrl.searchParams.get('keyword') || '').trim();
  if (keyword.length > 80) {
    return NextResponse.json(
      { error: '关键词无效' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const quotaFailure = await requireServerProxyQuota(
    'danmaku',
    request,
    guardResult.username,
  );
  if (quotaFailure) return quotaFailure;

  const limit = normalizeRuntimeParams(config.SiteConfig).DanmakuEpisodeLimit;
  try {
    const result = await getCachedDanmakuComments(
      episodeId,
      limit,
      request.nextUrl.searchParams.get('refresh') === '1',
      keyword,
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const rateLimited = danmakuRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    if (
      error instanceof DanmakuProviderError &&
      error.kind === 'episode-not-found'
    ) {
      return NextResponse.json(
        { error: '弹幕集数映射已失效', code: 'DANMAKU_EPISODE_NOT_FOUND' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    recordServerProxyFailure('danmaku', error);
    console.error('弹幕拉取失败:', error);

    const status =
      error instanceof DanmakuProviderError && error.kind === 'not-configured'
        ? 503
        : 502;
    return NextResponse.json(
      { error: '弹幕拉取失败' },
      { status, headers: NO_STORE_HEADERS },
    );
  }
}
