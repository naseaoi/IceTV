import { NextRequest, NextResponse } from 'next/server';

import {
  buildPlaybackDailyRanges,
  buildPlaybackDailyStatsFromTotals,
  buildPlaybackStatsSummaryFromParts,
} from '@/features/playback-stats/lib/summary';
import { dedupePlaybackSessionsByTitle } from '@/features/playback-stats/lib/history';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const now = Date.now();
    const dailyRanges = buildPlaybackDailyRanges(now);
    const weekStart = dailyRanges[0]?.start || now;
    const [totals, dailyTotals, recentItems, topItems] = await Promise.all([
      db.getPlaybackWatchTotals(guardResult.username, weekStart),
      db.getPlaybackRangeWatchTotals(guardResult.username, dailyRanges),
      db.getPlaybackSessions(guardResult.username, { limit: 50 }),
      db.getPlaybackTopItems(guardResult.username, 6),
    ]);
    const dailyWatchSeconds = buildPlaybackDailyStatsFromTotals(
      dailyRanges,
      dailyTotals,
    );

    return NextResponse.json(
      buildPlaybackStatsSummaryFromParts({
        totalWatchSeconds: totals.totalWatchSeconds,
        weekWatchSeconds: totals.periodWatchSeconds,
        dailyWatchSeconds,
        recentItems: dedupePlaybackSessionsByTitle(recentItems, 6),
        topItems,
      }),
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (err) {
    console.error('获取播放统计失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
