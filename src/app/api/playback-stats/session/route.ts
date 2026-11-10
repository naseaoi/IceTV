import { NextRequest, NextResponse } from 'next/server';

import { PLAYBACK_BUCKET_MS } from '@/features/playback-stats/types';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import type {
  PlaybackSession,
  PlaybackWatchBucket,
  WatchHistoryWrite,
} from '@/lib/types';

export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 255;
const MAX_LONG_TEXT_LENGTH = 2048;
const MAX_SESSION_SECONDS = 24 * 60 * 60;

function readString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function readNonNegativeInteger(value: unknown, maxValue: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), maxValue);
}

function readTimestamp(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const now = Date.now();
  return Math.min(Math.floor(parsed), now + 60_000);
}

function normalizeSession(input: unknown): PlaybackSession | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const now = Date.now();
  const id = readString(raw.id, 80);
  const source = readString(raw.source, 191);
  const videoId = readString(raw.video_id, 255);
  const title = readString(raw.title, MAX_TEXT_LENGTH);
  const startedAt = readTimestamp(raw.started_at, now);
  const endedAt = Math.max(readTimestamp(raw.ended_at, now), startedAt);
  const createdAt = readTimestamp(raw.created_at, startedAt);

  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  if (!source || !videoId || !title) return null;

  return {
    id,
    source,
    video_id: videoId,
    episode_index: readNonNegativeInteger(raw.episode_index, 10_000),
    title,
    source_name: readString(raw.source_name, MAX_TEXT_LENGTH),
    cover: readString(raw.cover, MAX_LONG_TEXT_LENGTH),
    year: readString(raw.year, 32),
    started_at: startedAt,
    ended_at: endedAt,
    watch_seconds: readNonNegativeInteger(
      raw.watch_seconds,
      MAX_SESSION_SECONDS,
    ),
    last_position: readNonNegativeInteger(
      raw.last_position,
      MAX_SESSION_SECONDS,
    ),
    total_time: readNonNegativeInteger(raw.total_time, MAX_SESSION_SECONDS),
    created_at: createdAt,
    updated_at: now,
  };
}

function normalizeBuckets(
  input: unknown,
  startedAt: number,
  now: number,
): PlaybackWatchBucket[] | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const buckets: PlaybackWatchBucket[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') return null;
    const { start, watch_ms: watchMs } = value;
    if (
      !Number.isSafeInteger(start) ||
      start % PLAYBACK_BUCKET_MS !== 0 ||
      start < startedAt - PLAYBACK_BUCKET_MS ||
      start > now + 60_000 ||
      !Number.isSafeInteger(watchMs) ||
      watchMs <= 0 ||
      watchMs > PLAYBACK_BUCKET_MS
    )
      return null;
    buckets.push({ start, watch_ms: watchMs });
  }
  return buckets;
}

function normalizeHistory(input: unknown): WatchHistoryWrite | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : undefined;
  if (raw.id !== undefined && (!id || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)))
    return null;
  if (
    !Number.isSafeInteger(raw.total_episodes) ||
    Number(raw.total_episodes) < 1 ||
    Number(raw.total_episodes) > 10_000
  )
    return null;
  for (const key of ['group_index', 'group_total']) {
    if (
      raw[key] !== undefined &&
      (!Number.isSafeInteger(raw[key]) ||
        Number(raw[key]) < 1 ||
        Number(raw[key]) > 10_000)
    )
      return null;
  }
  return {
    id,
    total_episodes: Number(raw.total_episodes),
    group_label:
      raw.group_label === undefined
        ? undefined
        : readString(raw.group_label, MAX_TEXT_LENGTH),
    group_index: raw.group_index as number | undefined,
    group_total: raw.group_total as number | undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = (await request.json().catch(() => null)) as {
      session?: unknown;
      buckets?: unknown;
      history?: unknown;
    } | null;
    const session = normalizeSession(body?.session);
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid playback session' },
        { status: 400 },
      );
    }

    let historyId: string | null = null;
    if (body && Object.prototype.hasOwnProperty.call(body, 'buckets')) {
      const buckets = normalizeBuckets(
        body.buckets,
        session.started_at,
        session.updated_at,
      );
      const history =
        body.history === undefined ? undefined : normalizeHistory(body.history);
      if (!buckets || history === null || session.episode_index < 1) {
        return NextResponse.json(
          { error: 'Invalid playback report' },
          { status: 400 },
        );
      }
      historyId = await db.saveWatchSessionReport(
        guardResult.username,
        session,
        buckets,
        history,
      );
    } else if (session.watch_seconds > 0) {
      await db.savePlaybackSession(guardResult.username, session);
    }

    return NextResponse.json(
      { success: true, historyId },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('保存播放统计失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
