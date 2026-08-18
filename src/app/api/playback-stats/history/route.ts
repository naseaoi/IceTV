import { NextRequest, NextResponse } from 'next/server';

import { getPlaybackHistoryPage } from '@/features/playback-stats/lib/historyPagination';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizePlaybackSearchKeyword } from '@/lib/playback-query';
import { normalizeRuntimeParams } from '@/lib/runtime-params';

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

function parseHistoryOffset(value: string | null, max: number): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < max ? parsed : 0;
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
    const historyLimit = Math.max(pageSize, runtimeParams.PlaybackHistoryLimit);
    const offset = parseHistoryOffset(searchParams.get('cursor'), historyLimit);
    const keyword = normalizePlaybackSearchKeyword(searchParams.get('q') ?? '');
    const response = await getPlaybackHistoryPage(
      (query) =>
        db.getPlaybackSessions(guardResult.username, { ...query, keyword }),
      offset,
      limit,
      historyLimit,
    );

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

    await db.deletePlaybackSession(guardResult.username, id);

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
