import { NextRequest, NextResponse } from 'next/server';

import { getPlaybackSourceUsage } from '@/features/playback-stats/lib/source-usage.server';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guard = await requireActiveUser(request);
  if (isGuardFailure(guard)) return guard.response;
  try {
    const items = await getPlaybackSourceUsage(90, guard.username);
    return NextResponse.json(
      {
        sources: items.map(({ source, watchSeconds }) => ({
          source,
          watchSeconds,
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('获取个人源观看统计失败', error);
    return NextResponse.json(
      { error: '观看统计暂不可用' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
