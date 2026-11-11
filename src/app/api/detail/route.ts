import { NextRequest, NextResponse } from 'next/server';

import { withAuthenticatedSourceProbeBudget } from '@/features/play/lib/sourceProbeGuard.server';
import type { ActiveUserInfo } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getCachedDetail } from '@/lib/detail-cache';
import { resourceLimitResponse } from '@/lib/server-resource-errors';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withAuthenticatedSourceProbeBudget(request, handleGet);
}

async function handleGet(request: NextRequest, guardResult: ActiveUserInfo) {
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
    const apiSites = await getAvailableApiSites(
      guardResult.username,
      config,
      guardResult.userAccess,
    );
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    const result = await getCachedDetail(apiSite, id, request.signal);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    console.error('获取视频详情失败:', error);
    return NextResponse.json({ error: '获取视频详情失败' }, { status: 500 });
  }
}
