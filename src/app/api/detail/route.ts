import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { createSwrCache } from '@/lib/server-cache';

export const runtime = 'nodejs';
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

// 进程内 SWR 缓存：detail 回源多为外部采集站，易出现 N 个用户同一 id 并发穿透。
// 新鲜 10 分钟、软过期再 20 分钟内返回旧值并后台刷新。
const detailCache = createSwrCache<any>({
  name: 'detail',
  freshMs: 10 * 60 * 1000,
  staleMs: 20 * 60 * 1000,
  maxSize: 2000,
  maxWeightBytes: 48 * 1024 * 1024,
});

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
  }

  try {
    const config = await getConfigForRead();
    const apiSites = await getAvailableApiSites(guardResult.username, config);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    const result = IS_DEVELOPMENT
      ? await getDetailFromApi(apiSite, id)
      : await detailCache.getOrLoad(`${sourceCode}::${id}`, () =>
          getDetailFromApi(apiSite, id),
        );

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
