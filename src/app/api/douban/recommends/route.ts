import { NextRequest, NextResponse } from 'next/server';

import { recommendsCache } from '@/app/api/douban/recommends/cache';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { createPrivateApiCacheHeaders } from '@/lib/api-cache-headers';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import {
  DoubanRecommendApiResponse,
  normalizeDoubanRecommendItems,
} from '@/lib/douban-normalize';
import { buildDoubanRecommendUrl } from '@/lib/douban-upstream-url';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  const quotaFailure = await requireServerProxyQuota(
    'douban-data',
    request,
    guardResult.username,
  );
  if (quotaFailure) return quotaFailure;

  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind');
  const pageLimit = Number(searchParams.get('limit') || '20');
  const pageStart = Number(searchParams.get('start') || '0');
  if (!kind) {
    return NextResponse.json({ error: '缺少必要参数: kind' }, { status: 400 });
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }

  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 },
    );
  }

  if (!Number.isInteger(pageStart) || pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 },
    );
  }

  const target = buildDoubanRecommendUrl({
    kind: kind as 'tv' | 'movie',
    start: pageStart,
    limit: pageLimit,
    category: searchParams.get('category'),
    format: searchParams.get('format'),
    label: searchParams.get('label'),
    region: searchParams.get('region'),
    year: searchParams.get('year'),
    platform: searchParams.get('platform'),
    sort: searchParams.get('sort'),
  });
  try {
    // 以完整 target URL 作为缓存键，参数变体天然区分
    const response = await recommendsCache.getOrLoad(target, async () => {
      const doubanData =
        await fetchDoubanData<DoubanRecommendApiResponse>(target);
      const list = normalizeDoubanRecommendItems(doubanData.items);
      const payload: DoubanResult = {
        code: 200,
        message: '获取成功',
        list: list,
      };
      return payload;
    });

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: createPrivateApiCacheHeaders(cacheTime),
    });
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    recordServerProxyFailure('douban-data', error);
    return NextResponse.json({ error: '获取豆瓣数据失败' }, { status: 500 });
  }
}
