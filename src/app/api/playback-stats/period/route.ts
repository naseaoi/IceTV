import { NextRequest, NextResponse } from 'next/server';

import {
  aggregatePlaybackPeriod,
  aggregatePlaybackRhythm,
  buildPlaybackPeriod,
  currentPlaybackStreak,
  PlaybackPeriodValidationError,
  playbackStreakRange,
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
    const now = Date.now();
    const streakRange = playbackStreakRange(period.timeZone, now);
    const [sessions, totals, rhythmData, streakData] = await Promise.all([
      db.getPlaybackPeriodSessions(guard.username, period.start, period.end),
      db.getPlaybackWatchTotals(guard.username, period.start),
      db.getPlaybackAnnualData(guard.username, period.start, period.end),
      db.getPlaybackAnnualData(
        guard.username,
        streakRange.start,
        streakRange.end,
      ),
    ]);
    return NextResponse.json(
      {
        ...aggregatePlaybackPeriod(period, sessions, totals.totalWatchSeconds),
        hours: aggregatePlaybackRhythm(rhythmData, period).hours,
        currentStreak: currentPlaybackStreak(
          aggregatePlaybackRhythm(streakData, {
            ...streakRange,
            timeZone: period.timeZone,
          }).days,
          period.timeZone,
          now,
        ),
      },
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
