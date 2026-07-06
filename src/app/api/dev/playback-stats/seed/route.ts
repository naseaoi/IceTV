import { NextRequest, NextResponse } from 'next/server';

import { buildDevPlaybackStatsSessions } from '@/features/playback-stats/lib/dev-seed';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

function buildDevOnlyResponse() {
  return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

async function seedPlaybackStats(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return buildDevOnlyResponse();
  }

  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const sessions = buildDevPlaybackStatsSessions();
    await Promise.all(
      sessions.map((session) =>
        db.savePlaybackSession(guardResult.username, session),
      ),
    );

    return NextResponse.json(
      {
        success: true,
        username: guardResult.username,
        count: sessions.length,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('写入开发播放统计测试数据失败', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  return seedPlaybackStats(request);
}
