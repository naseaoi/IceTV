import { NextRequest, NextResponse } from 'next/server';

import { getBangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import {
  BANGUMI_CALENDAR_FRESH_SECONDS,
  BANGUMI_CALENDAR_STALE_SECONDS,
} from '@/features/home/lib/home-cache';

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const source = request.nextUrl.searchParams.get('source');

    if (source && source !== 'server') {
      return NextResponse.json([], {
        status: 400,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const timeoutMs = readTimeoutMs(
      request.nextUrl.searchParams.get('timeoutMs'),
    );
    const data = await getBangumiCalendarData({
      timeoutMs,
    });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, max-age=${BANGUMI_CALENDAR_FRESH_SECONDS}, stale-while-revalidate=${BANGUMI_CALENDAR_STALE_SECONDS}`,
      },
    });
  } catch {
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
}

function readTimeoutMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const timeoutMs = Number(value);

  if (!Number.isFinite(timeoutMs)) {
    return undefined;
  }

  return Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}
