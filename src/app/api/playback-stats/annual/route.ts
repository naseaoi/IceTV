import { NextRequest, NextResponse } from 'next/server';

import { aggregateAnnualReport } from '@/features/playback-stats/lib/annual-report';
import {
  buildPlaybackPeriod,
  PlaybackPeriodValidationError,
} from '@/features/playback-stats/lib/period';
import {
  annualReportNotReleasedMessage,
  isAnnualReportReleased,
} from '@/lib/annual-report-window';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { readPlaybackStatsRetentionDays } from '@/lib/cron/playback-retention';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const params = new URL(request.url).searchParams;
    const now = Date.now();
    const current = buildPlaybackPeriod(
      { type: 'year', timeZone: params.get('tz') },
      now,
    );
    const currentYear = Number(current.date.slice(0, 4));
    const rawYear = params.get('year');
    const year = rawYear === null ? currentYear : Number(rawYear);
    if (
      (rawYear !== null && !/^\d{4}$/.test(rawYear)) ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > currentYear
    ) {
      throw new PlaybackPeriodValidationError('年份无效');
    }
    const preview = guard.role === 'owner' || guard.role === 'admin';
    if (!preview && !isAnnualReportReleased(year, current.date)) {
      return NextResponse.json(
        { error: annualReportNotReleasedMessage(year) },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    const period = buildPlaybackPeriod(
      { type: 'year', date: `${year}-01-01`, timeZone: current.timeZone },
      now,
    );
    const [data, reviews] = await Promise.all([
      db.getPlaybackAnnualData(guard.username, period.start, period.end),
      db.getAllVideoReviews(guard.username),
    ]);
    return NextResponse.json(
      aggregateAnnualReport({
        year,
        includeUnreleased: preview,
        timeZone: period.timeZone,
        now,
        data,
        reviews,
        retentionDays: readPlaybackStatsRetentionDays(),
      }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof PlaybackPeriodValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error('获取年度观看报告失败', error);
    return NextResponse.json(
      { error: '获取年度观看报告失败' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
