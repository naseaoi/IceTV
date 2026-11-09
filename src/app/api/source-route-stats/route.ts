import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { recordSourcePlayOutcome } from '@/lib/source-health.server';
import type { SourceRouteStatInput } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_SOURCE_LENGTH = 191;
type PlayOutcome = Omit<SourceRouteStatInput, 'routeMode'>;

function readOutcome(raw: unknown): PlayOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  if (
    !source ||
    source.length > MAX_SOURCE_LENGTH ||
    typeof record.success !== 'boolean' ||
    typeof record.eventAt !== 'number' ||
    !Number.isFinite(record.eventAt) ||
    record.eventAt <= 0
  )
    return null;
  return {
    source,
    success: record.success,
    eventAt: Math.min(Math.floor(record.eventAt), Date.now() + 60_000),
  };
}

function readStat(raw: unknown): SourceRouteStatInput | null {
  const outcome = readOutcome(raw);
  if (!outcome) return null;
  const { routeMode } = raw as Record<string, unknown>;
  if (routeMode !== 'browser' && routeMode !== 'server') return null;
  return { ...outcome, routeMode };
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '播放统计格式无效' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const stat = 'stat' in input ? readStat(input.stat) : null;
    const outcome = 'outcome' in input ? readOutcome(input.outcome) : null;
    if (
      (!stat && !outcome) ||
      ('stat' in input && !stat) ||
      ('outcome' in input && !outcome)
    ) {
      return NextResponse.json({ error: '播放统计格式无效' }, { status: 400 });
    }

    const config = await getConfigForRead();
    const availableSources = new Set(
      (await getAvailableApiSites(guardResult.username, config)).map(
        (source) => source.key,
      ),
    );
    if (
      (stat && !availableSources.has(stat.source)) ||
      (outcome && !availableSources.has(outcome.source))
    ) {
      return NextResponse.json({ error: '播放源不可用' }, { status: 400 });
    }

    await Promise.all([
      stat ? db.recordSourceRouteStat(stat) : undefined,
      outcome
        ? recordSourcePlayOutcome(
            guardResult.username,
            outcome.source,
            outcome.success,
            outcome.eventAt,
          )
        : undefined,
    ]);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('保存源站播放统计失败', error);
    return NextResponse.json({ error: '保存播放统计失败' }, { status: 500 });
  }
}
