'use client';

import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
} from '@/features/playback-stats/lib/history';
import type {
  PlaybackHistoryResponse,
  PlaybackStatsSummary,
  PlaybackTopItemsResponse,
  PlaybackTopRange,
} from '@/features/playback-stats/types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';

const PLAYBACK_HISTORY_PAGE_SIZE = 10;

let playbackStatsSummaryCache: {
  username: string;
  data: PlaybackStatsSummary;
} | null = null;
let playbackHistoryCache: {
  username: string;
  data: PlaybackHistoryResponse;
} | null = null;

export function getCachedPlaybackStatsSummarySnapshot(): PlaybackStatsSummary | null {
  const username = getAuthInfoFromBrowserCookie()?.username;
  return username && playbackStatsSummaryCache?.username === username
    ? playbackStatsSummaryCache.data
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
  playbackHistoryCache = {
    username,
    data: {
      items: dedupePlaybackSessionsByTitle(
        filterPlaybackHistorySessions(snapshot.items),
        {
          mergeWatchSeconds: true,
        },
      ),
      nextCursor: snapshot.nextCursor,
    },
  };
}

export function removePlaybackHistorySnapshotItem(id: string): void {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username || playbackHistoryCache?.username !== username) return;
  playbackHistoryCache = {
    username,
    data: {
      items: playbackHistoryCache.data.items.filter((item) => item.id !== id),
      nextCursor: playbackHistoryCache.data.nextCursor,
    },
  };
}

export async function getPlaybackStatsSummary(): Promise<PlaybackStatsSummary | null> {
  if (!getAuthInfoFromBrowserCookie()?.username) return null;

  const response = await fetch('/api/playback-stats/summary?range=7d', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Playback stats summary failed: ${response.status}`);
  }
  const summary = (await response.json()) as PlaybackStatsSummary;
  const normalizedSummary = {
    ...summary,
    recentItems: dedupePlaybackSessionsByTitle(summary.recentItems, 6),
  };
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (username) {
    playbackStatsSummaryCache = { username, data: normalizedSummary };
  }
  return normalizedSummary;
}

export async function getPlaybackTopItems(
  range: PlaybackTopRange,
): Promise<PlaybackTopItemsResponse> {
  if (!getAuthInfoFromBrowserCookie()?.username) {
    return { range, items: [] };
  }

  const params = new URLSearchParams({ range });
  const response = await fetch(`/api/playback-stats/top?${params}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Playback top items failed: ${response.status}`);
  }
  return (await response.json()) as PlaybackTopItemsResponse;
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
