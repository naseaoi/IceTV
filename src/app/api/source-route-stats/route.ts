import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import type { SourceRouteMode, SourceRouteStatInput } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_SOURCE_LENGTH = 191;

function readSource(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().slice(0, MAX_SOURCE_LENGTH)
    : '';
}

function readRouteMode(value: unknown): SourceRouteMode {
  return value === 'server' ? 'server' : 'browser';
}

function readEventAt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Date.now();
  }
  return Math.min(Math.floor(parsed), Date.now() + 60_000);
}

function normalizeInput(raw: unknown): SourceRouteStatInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const source = readSource(record.source);
  if (!source) return null;

  return {
    source,
    routeMode: readRouteMode(record.routeMode),
    success: record.success === true,
    eventAt: readEventAt(record.eventAt),
  };
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = (await request.json()) as { stat?: unknown };
    const stat = normalizeInput(body.stat);
    if (!stat) {
      return NextResponse.json(
        { error: 'Invalid route stat' },
        { status: 400 },
      );
    }

    await db.recordSourceRouteStat(stat);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('保存源站路由统计失败', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
