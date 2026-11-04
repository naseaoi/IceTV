import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { createPublicApiCacheHeaders } from '@/lib/api-cache-headers';
import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { createSharedServerCache } from '@/lib/shared-server-cache';

export const runtime = 'nodejs';

const DOUBAN_ID_PATTERN = /^\d{1,12}$/;

interface DoubanSubjectAbstract {
  subject?: { rate?: string };
}

const ratingCache = createSharedServerCache<number | null>({
  name: 'douban-rating-v1',
  ...getServerCacheBudget('douban-route'),
  freshMs: 24 * 60 * 60 * 1000,
  staleMs: 6 * 24 * 60 * 60 * 1000,
});

function parseDoubanRate(data: DoubanSubjectAbstract): number | null {
  const rate = Number.parseFloat(data.subject?.rate || '');
  return Number.isFinite(rate) && rate > 0 && rate <= 10 ? rate : null;
}

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  const id = new URL(request.url).searchParams.get('id') || '';
  if (!DOUBAN_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: '豆瓣 ID 无效' }, { status: 400 });
  }

  const target = `https://movie.douban.com/j/subject_abstract?subject_id=${id}`;
  // 命中本地缓存不回源，不占用代理配额
  if (!ratingCache.peek(target)) {
    const quotaFailure = await requireServerProxyQuota(
      'douban-data',
      request,
      guardResult.username,
    );
    if (quotaFailure) return quotaFailure;
  }

  try {
    const rate = await ratingCache.getOrLoad(target, async () =>
      parseDoubanRate(
        await fetchDoubanData<DoubanSubjectAbstract>(target, {
          cache: 'no-store',
        }),
      ),
    );

    return NextResponse.json(
      { rate },
      { headers: createPublicApiCacheHeaders(await getCacheTime()) },
    );
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    recordServerProxyFailure('douban-data', error);
    return NextResponse.json({ error: '获取豆瓣评分失败' }, { status: 500 });
  }
}
