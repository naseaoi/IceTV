import { NextRequest, NextResponse } from 'next/server';

import {
  aggregatePlaybackPeriod,
  buildPlaybackPeriod,
  PlaybackPeriodValidationError,
} from '@/features/playback-stats/lib/period';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const params = new URL(request.url).searchParams;
    const period = buildPlaybackPeriod({
      type: params.get('type'),
      date: params.get('date'),
      timeZone: params.get('tz'),
    });
    const [sessions, totals] = await Promise.all([
      db.getPlaybackPeriodSessions(guard.username, period.start, period.end),
      db.getPlaybackWatchTotals(guard.username, period.start),
    ]);
    return NextResponse.json(
      aggregatePlaybackPeriod(period, sessions, totals.totalWatchSeconds),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof PlaybackPeriodValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error('获取播放统计失败', error);
    return NextResponse.json(
      { error: '获取播放统计失败' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
