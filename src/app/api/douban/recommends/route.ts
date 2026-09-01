import { NextRequest, NextResponse } from 'next/server';

import { recommendsCache } from '@/app/api/douban/recommends/cache';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { createPublicApiCacheHeaders } from '@/lib/api-cache-headers';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import {
  DoubanRecommendApiResponse,
  normalizeDoubanRecommendItems,
} from '@/lib/douban-normalize';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  const quotaFailure = requireServerProxyQuota(
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
  const category =
    searchParams.get('category') === 'all' ? '' : searchParams.get('category');
  const format =
    searchParams.get('format') === 'all' ? '' : searchParams.get('format');
  const region =
    searchParams.get('region') === 'all' ? '' : searchParams.get('region');
  const year =
    searchParams.get('year') === 'all' ? '' : searchParams.get('year');
  const platform =
    searchParams.get('platform') === 'all' ? '' : searchParams.get('platform');
  const sort = searchParams.get('sort') === 'T' ? '' : searchParams.get('sort');
  const label =
    searchParams.get('label') === 'all' ? '' : searchParams.get('label');

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

  const selectedCategories = { 类型: category } as any;
  if (format) {
    selectedCategories['形式'] = format;
  }
  if (region) {
    selectedCategories['地区'] = region;
  }

  const tags = [] as Array<string>;
  if (category) {
    tags.push(category);
  }
  if (!category && format) {
    tags.push(format);
  }
  if (label) {
    tags.push(label);
  }
  if (region) {
    tags.push(region);
  }
  if (year) {
    tags.push(year);
  }
  if (platform) {
    tags.push(platform);
  }

  const baseUrl = `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const params = new URLSearchParams();
  params.append('refresh', '0');
  params.append('start', pageStart.toString());
  params.append('count', pageLimit.toString());
  params.append('selected_categories', JSON.stringify(selectedCategories));
  params.append('uncollect', 'false');
  params.append('score_range', '0,10');
  params.append('tags', tags.join(','));
  if (sort) {
    params.append('sort', sort);
  }

  const target = `${baseUrl}?${params.toString()}`;
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
      headers: createPublicApiCacheHeaders(cacheTime),
    });
  } catch (error) {
    recordServerProxyFailure('douban-data', error);
    return NextResponse.json({ error: '获取豆瓣数据失败' }, { status: 500 });
  }
}
