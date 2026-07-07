import { NextRequest, NextResponse } from 'next/server';

import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
} from '@/features/playback-stats/lib/history';
import type { PlaybackHistoryResponse } from '@/features/playback-stats/types';
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
    const cursor = searchParams.get('cursor');
    const keyword = normalizePlaybackSearchKeyword(searchParams.get('q') ?? '');
    const fetchLimit = Math.min(Math.max(limit * 5, limit + 1), 500);
    const sessions = await db.getPlaybackSessions(guardResult.username, {
      limit: fetchLimit,
      cursor: cursor ? Number(cursor) : undefined,
      keyword,
    });
    const dedupedSessions = dedupePlaybackSessionsByTitle(
      filterPlaybackHistorySessions(sessions),
      {
        limit: limit + 1,
        mergeWatchSeconds: true,
      },
    );
    const items = dedupedSessions.slice(0, limit);
    const response: PlaybackHistoryResponse = {
      items,
      nextCursor:
        dedupedSessions.length > limit && items.length > 0
          ? items[items.length - 1].started_at
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
