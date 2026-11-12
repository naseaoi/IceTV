import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizePlaybackSearchKeyword } from '@/lib/playback-query';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import type { WatchHistoryCursor } from '@/lib/types';

export const runtime = 'nodejs';

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSessionId(value: string | null): string | null {
  const id = value?.trim() || '';
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : null;
}

function parseCursor(value: string): WatchHistoryCursor | null {
  if (value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !parsed ||
      !Number.isSafeInteger(parsed.lastWatchedAt) ||
      parsed.lastWatchedAt < 0 ||
      typeof parsed.id !== 'string' ||
      !normalizeSessionId(parsed.id)
    )
      return null;
    return { lastWatchedAt: parsed.lastWatchedAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const runtimeParams = normalizeRuntimeParams(
      (await getConfigForRead()).SiteConfig,
    );
    const pageSize = runtimeParams.PlaybackHistoryPageSize;
    const limit = Math.min(
      parsePositiveInteger(searchParams.get('limit'), pageSize),
      pageSize,
    );
    const rawCursor = searchParams.get('cursor');
    const cursor = rawCursor ? parseCursor(rawCursor) : undefined;
    if (cursor === null)
      return NextResponse.json(
        { error: 'Invalid history cursor' },
        { status: 400 },
      );
    const keyword = normalizePlaybackSearchKeyword(searchParams.get('q') ?? '');
    const rows = await db.getWatchHistoryPage(guardResult.username, {
      limit: limit + 1,
      cursor,
      keyword,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const response = {
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                lastWatchedAt: last.last_watched_at,
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    console.error('获取播放历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const id = normalizeSessionId(searchParams.get('id'));
    if (!id) {
      return NextResponse.json(
        { error: 'Invalid playback history id' },
        { status: 400 },
      );
    }

    await db.deleteWatchHistoryEntry(guardResult.username, id);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('删除播放历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
