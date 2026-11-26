import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { flushSourceProxyFailures } from '@/lib/source-proxy-failures.server';

export const runtime = 'nodejs';

function readDays(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(Math.max(parsed, 1), 30);
}

function getSinceDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const days = readDays(request.nextUrl.searchParams.get('days'));
    const sinceDate = getSinceDate(days);
    await flushSourceProxyFailures();
    const [stats, proxyFailures] = await Promise.all([
      db.getSourceRouteStats(sinceDate),
      db.getSourceProxyFailures(sinceDate),
    ]);

    return NextResponse.json(
      { days, stats, proxyFailures },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('读取源站路由统计失败', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
