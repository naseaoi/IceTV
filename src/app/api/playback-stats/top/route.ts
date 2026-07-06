import { NextRequest, NextResponse } from 'next/server';

import type { PlaybackTopRange } from '@/features/playback-stats/types';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeTopRange(value: string | null): PlaybackTopRange {
  return value === 'month' || value === 'all' ? value : 'week';
}

function getTopRangeStart(range: PlaybackTopRange, now = Date.now()) {
  if (range === 'all') return undefined;
  const days = range === 'month' ? 29 : 6;
  return startOfLocalDay(now) - days * DAY_MS;
}

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const range = normalizeTopRange(searchParams.get('range'));
    const items = await db.getPlaybackTopItems(
      guardResult.username,
      6,
      getTopRangeStart(range),
    );

    return NextResponse.json(
      { range, items },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('获取常看内容失败', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
