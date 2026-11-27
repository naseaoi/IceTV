import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { FixedWindowRateLimiter } from '@/lib/fixed-window-rate-limit';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import {
  recordSourcePlayOutcome,
  recordSourceSmoothness,
} from '@/lib/source-health.server';
import type {
  SourceRouteStatInput,
  SourceSmoothnessPayload,
} from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

export const runtime = 'nodejs';

const MAX_SOURCE_LENGTH = 191;
const limiter = new FixedWindowRateLimiter(120, 60_000);
type PlayOutcome = Omit<SourceRouteStatInput, 'routeMode' | 'phase'>;

function readEvent(
  raw: unknown,
): Pick<PlayOutcome, 'source' | 'eventAt'> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  if (
    !source ||
    source.length > MAX_SOURCE_LENGTH ||
    typeof record.eventAt !== 'number' ||
    !Number.isFinite(record.eventAt) ||
    record.eventAt <= 0
  )
    return null;
  return {
    source,
    eventAt: Math.min(Math.floor(record.eventAt), Date.now() + 60_000),
  };
}

function readOutcome(raw: unknown): PlayOutcome | null {
  const event = readEvent(raw);
  if (!event) return null;
  const { success } = raw as Record<string, unknown>;
  return typeof success === 'boolean' ? { ...event, success } : null;
}

function readSmooth(raw: unknown): SourceSmoothnessPayload | null {
  const event = readEvent(raw);
  if (!event) return null;
  const { routeMode, mediaType, watchMs, stallMs, stallCount, unknownMs } =
    raw as Record<string, unknown>;
  if (
    (routeMode !== 'browser' && routeMode !== 'server') ||
    (mediaType !== 'hls' && mediaType !== 'mp4') ||
    typeof watchMs !== 'number' ||
    !Number.isFinite(watchMs) ||
    watchMs < 0 ||
    watchMs > 600_000 ||
    typeof stallMs !== 'number' ||
    !Number.isFinite(stallMs) ||
    stallMs < 0 ||
    stallMs > watchMs + 30_000 ||
    typeof unknownMs !== 'number' ||
    !Number.isFinite(unknownMs) ||
    unknownMs < 0 ||
    unknownMs > watchMs + 30_000 ||
    typeof stallCount !== 'number' ||
    !Number.isFinite(stallCount) ||
    stallCount < 0 ||
    stallCount > 120
  )
    return null;
  return {
    ...event,
    routeMode,
    mediaType,
    watchMs: Math.floor(watchMs),
    stallMs: Math.floor(stallMs),
    stallCount: Math.floor(stallCount),
    unknownMs: Math.floor(unknownMs),
  };
}

function readStat(raw: unknown): SourceRouteStatInput | null {
  const outcome = readOutcome(raw);
  if (!outcome) return null;
  const { routeMode, phase } = raw as Record<string, unknown>;
  if (routeMode !== 'browser' && routeMode !== 'server') return null;
  if (phase !== 'primary' && phase !== 'fallback') return null;
  return { ...outcome, routeMode, phase };
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const verdict = limiter.check(normalizeUsername(guardResult.username));
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: '播放统计上报过于频繁，请稍后重试' },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            'Retry-After': String(verdict.retryAfterSeconds),
          },
        },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '播放统计格式无效' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const legacyStat =
      input.stat !== null &&
      typeof input.stat === 'object' &&
      !Array.isArray(input.stat) &&
      !('phase' in input.stat);
    const stat = 'stat' in input && !legacyStat ? readStat(input.stat) : null;
    const outcome = 'outcome' in input ? readOutcome(input.outcome) : null;
    const smooth = 'smooth' in input ? readSmooth(input.smooth) : null;
    if (
      (!stat && !outcome && !smooth && !legacyStat) ||
      ('smooth' in input && !smooth) ||
      ('stat' in input && !stat && !legacyStat) ||
      ('outcome' in input && !outcome)
    ) {
      return NextResponse.json({ error: '播放统计格式无效' }, { status: 400 });
    }

    const config = await getConfigForRead();
    const availableSources = new Set(
      (
        await getAvailableApiSites(
          guardResult.username,
          config,
          guardResult.userAccess,
        )
      ).map((source) => source.key),
    );
    if (
      (smooth && !availableSources.has(smooth.source)) ||
      (stat && !availableSources.has(stat.source)) ||
      (outcome && !availableSources.has(outcome.source))
    ) {
      return NextResponse.json({ error: '播放源不可用' }, { status: 400 });
    }

    await Promise.all([
      smooth &&
      (smooth.watchMs ||
        smooth.stallMs ||
        smooth.stallCount ||
        smooth.unknownMs)
        ? recordSourceSmoothness(guardResult.username, smooth)
        : undefined,
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
