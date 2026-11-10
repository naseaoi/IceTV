'use client';

import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
} from '@/features/playback-stats/lib/history';
import type {
  PlaybackHistoryResponse,
  PlaybackPeriodStats,
  PlaybackPeriodType,
} from '@/features/playback-stats/types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { writeListCountCookie } from '@/lib/list-count-cookies';

const PLAYBACK_HISTORY_PAGE_SIZE = 10;

const playbackPeriodCache = new Map<string, PlaybackPeriodStats>();

function periodCacheKey(
  username: string,
  type: PlaybackPeriodType,
  date?: string,
): string {
  return JSON.stringify([username, type, date ?? 'current']);
}

let playbackHistoryCache: {
  username: string;
  data: PlaybackHistoryResponse;
} | null = null;

function setPlaybackHistoryCache(
  username: string,
  data: PlaybackHistoryResponse,
): void {
  playbackHistoryCache = { username, data };
  writeListCountCookie('history_count', data.items.length);
}

export function getCachedPlaybackPeriodSnapshot(
  type: PlaybackPeriodType,
  date?: string,
): PlaybackPeriodStats | null {
  const username = getAuthInfoFromBrowserCookie()?.username;
  return username
    ? (playbackPeriodCache.get(periodCacheKey(username, type, date)) ?? null)
    : null;
}

export function getCachedPlaybackHistorySnapshot(): PlaybackHistoryResponse | null {
  const username = getAuthInfoFromBrowserCookie()?.username;
  const snapshot =
    username && playbackHistoryCache?.username === username
      ? playbackHistoryCache.data
      : null;
  return snapshot
    ? {
        items: dedupePlaybackSessionsByTitle(
          filterPlaybackHistorySessions(snapshot.items),
          {
            mergeWatchSeconds: true,
          },
        ),
        nextCursor: snapshot.nextCursor,
      }
    : null;
}

export function cachePlaybackHistorySnapshot(
  snapshot: PlaybackHistoryResponse,
): void {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username) return;
  setPlaybackHistoryCache(username, {
    items: dedupePlaybackSessionsByTitle(
      filterPlaybackHistorySessions(snapshot.items),
      {
        mergeWatchSeconds: true,
      },
    ),
    nextCursor: snapshot.nextCursor,
  });
}

export function removePlaybackHistorySnapshotItem(id: string): void {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username || playbackHistoryCache?.username !== username) return;
  setPlaybackHistoryCache(username, {
    items: playbackHistoryCache.data.items.filter((item) => item.id !== id),
    nextCursor: playbackHistoryCache.data.nextCursor,
  });
}

export async function getPlaybackPeriodStats(
  type: PlaybackPeriodType,
  date?: string,
): Promise<PlaybackPeriodStats | null> {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username) return null;
  const params = new URLSearchParams({
    type,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (date !== undefined) params.set('date', date);
  const response = await fetch(`/api/playback-stats/period?${params}`, {
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`Playback period stats failed: ${response.status}`);
  const stats = (await response.json()) as PlaybackPeriodStats;
  if (getAuthInfoFromBrowserCookie()?.username === username) {
    playbackPeriodCache.set(periodCacheKey(username, type, date), stats);
  }
  return stats;
}

export async function getPlaybackHistory(
  cursor?: number,
  keyword?: string,
  limit = PLAYBACK_HISTORY_PAGE_SIZE,
): Promise<PlaybackHistoryResponse> {
  if (!getAuthInfoFromBrowserCookie()?.username) {
    return { items: [], nextCursor: null };
  }

  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (cursor) params.set('cursor', String(cursor));
  if (keyword) params.set('q', keyword);

  const response = await fetch(`/api/playback-stats/history?${params}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Playback history failed: ${response.status}`);
  }
  const history = (await response.json()) as PlaybackHistoryResponse;
  if (!cursor && !keyword) {
    cachePlaybackHistorySnapshot(history);
  }
  return history;
}

export async function deletePlaybackHistoryItem(id: string): Promise<void> {
  const normalizedId = id.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(normalizedId)) {
    throw new Error('Invalid playback history id');
  }

  const response = await fetch(
    `/api/playback-stats/history?id=${encodeURIComponent(normalizedId)}`,
    {
      method: 'DELETE',
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    throw new Error(`Delete playback history failed: ${response.status}`);
  }

  removePlaybackHistorySnapshotItem(normalizedId);
}
