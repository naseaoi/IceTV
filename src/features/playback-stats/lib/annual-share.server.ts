import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { aggregateAnnualReport } from '@/features/playback-stats/lib/annual-report';
import {
  annualShareState,
  publicAnnualReport,
} from '@/features/playback-stats/lib/annual-share';
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
import { normalizeUsername } from '@/lib/username';

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: NO_STORE_HEADERS });

function parseYear(value: unknown): number {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d{4}$/.test(String(value)) ||
    Number(value) < 2000 ||
    Number(value) > 9999
  )
    throw new PlaybackPeriodValidationError('年份无效');
  return Number(value);
}

function failure(error: unknown) {
  if (error instanceof PlaybackPeriodValidationError)
    return json({ error: error.message }, 400);
  console.error('年度报告公开操作失败', error);
  return json({ error: '年度报告操作失败，请稍后重试' }, 500);
}

export async function handleAnnualShare(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    if (request.method !== 'PUT') {
      const year = parseYear(new URL(request.url).searchParams.get('year'));
      if (request.method === 'DELETE') {
        await db.deleteAnnualRecap(guard.username, year);
        return json(annualShareState(year, null));
      }
      return json(
        annualShareState(year, await db.getAnnualRecap(guard.username, year)),
      );
    }
    let body: Record<string, unknown>;
    try {
      body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error();
    } catch {
      throw new PlaybackPeriodValidationError('请求体必须为有效 JSON 对象');
    }
    const year = parseYear(body.year);
    if (typeof body.hideRhythm !== 'boolean')
      throw new PlaybackPeriodValidationError('隐藏作息必须为布尔值');
    if (typeof body.tz !== 'string')
      throw new PlaybackPeriodValidationError('时区无效');
    const now = Date.now();
    const current = buildPlaybackPeriod(
      { type: 'year', timeZone: body.tz },
      now,
    );
    if (!isAnnualReportReleased(year, current.date))
      return json({ error: annualReportNotReleasedMessage(year) }, 403);
    const period = buildPlaybackPeriod(
      { type: 'year', date: `${year}-01-01`, timeZone: body.tz },
      now,
    );
    const [data, reviews, activity] = await Promise.all([
      db.getPlaybackAnnualData(guard.username, period.start, period.end),
      db.getAllVideoReviews(guard.username),
      db.getAnnualActivity(guard.username, period.start, period.end),
    ]);
    const report = aggregateAnnualReport({
      year,
      timeZone: period.timeZone,
      now,
      data,
      reviews,
      activity,
      retentionDays: readPlaybackStatsRetentionDays(),
    });
    if (report.totals.watchSeconds <= 0)
      return json({ error: '当年暂无观看统计' }, 400);
    await db.ensureUserProfile(guard.username);
    await db.saveAnnualRecap(
      guard.username,
      publicAnnualReport(report, reviews, body.hideRhythm, activity),
      now,
    );
    return json(
      annualShareState(year, await db.getAnnualRecap(guard.username, year)),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function handlePublicAnnualRecap(
  request: NextRequest,
  context: { params: Promise<{ profileId: string; year: string }> },
) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const params = await context.params;
    const year = parseYear(params.year);
    const profile = await db.getUserProfileById(params.profileId);
    const recap = profile
      ? await db.getAnnualRecap(profile.username, year)
      : null;
    if (!profile || !recap)
      return json({ error: '年度报告未公开或不存在' }, 404);
    return json({
      owner: {
        profileId: profile.profile_id,
        nickname: profile.nickname,
        avatarSeed: profile.avatar_seed,
        level: profile.level ?? 1,
      },
      isSelf: profile.username === normalizeUsername(guard.username),
      report: recap.report,
      years: await db.getAnnualRecapYears(profile.username),
    });
  } catch (error) {
    return failure(error);
  }
}
