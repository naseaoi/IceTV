import { NextRequest, NextResponse } from 'next/server';

import { danmakuSearchCache } from '@/app/api/danmaku/cache';
import {
  isDanmakuProviderConfigured,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/provider.server';
import { DanmakuProviderError } from '@/features/play/lib/danmaku/types';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_KEYWORD_LENGTH = 80;
const MAX_CANDIDATES_PER_PAGE = 240;
const MAX_CANDIDATE_OFFSET = 10_000;

function parseCandidateOffset(value: string | null): number | null {
  if (value === null || value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset > MAX_CANDIDATE_OFFSET) {
    return null;
  }
  return offset;
}

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

  const keyword = (request.nextUrl.searchParams.get('keyword') || '').trim();
  if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) {
    return NextResponse.json(
      { error: '关键词无效' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const offset = parseCandidateOffset(
    request.nextUrl.searchParams.get('offset'),
  );
  if (offset === null) {
    return NextResponse.json(
      { error: '候选偏移量无效' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const quotaFailure = requireServerProxyQuota(
    'danmaku',
    request,
    guardResult.username,
  );
  if (quotaFailure) return quotaFailure;

  try {
    if (request.nextUrl.searchParams.get('refresh') === '1') {
      danmakuSearchCache.invalidate(keyword);
    }
    const candidates = await danmakuSearchCache.getOrLoad(keyword, () =>
      searchDanmakuCandidates(keyword),
    );
    const pageEnd = offset + MAX_CANDIDATES_PER_PAGE;

    return NextResponse.json(
      {
        candidates: candidates.slice(offset, pageEnd),
        hasMore: pageEnd < candidates.length,
        nextOffset: pageEnd < candidates.length ? pageEnd : null,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    recordServerProxyFailure('danmaku', error);
    console.error('弹幕搜索失败:', error);

    const status =
      error instanceof DanmakuProviderError && error.kind === 'not-configured'
        ? 503
        : 502;
    return NextResponse.json(
      { error: '弹幕搜索失败' },
      { status, headers: NO_STORE_HEADERS },
    );
  }
}
