import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
  normalizePlaybackTitleKey,
} from '@/features/playback-stats/lib/history';
import type {
  PlaybackDailyStat,
  PlaybackStatsSummary,
  PlaybackTopItem,
} from '@/features/playback-stats/types';
import type {
  PlaybackRangeWatchTotal,
  PlaybackSession,
  PlaybackTimeRange,
} from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildPlaybackDailyStats(
  sessions: PlaybackSession[],
  now: number,
): PlaybackDailyStat[] {
  const todayStart = startOfLocalDay(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const dayStart = todayStart - (6 - index) * DAY_MS;
    return {
      date: formatLocalDate(dayStart),
      watchSeconds: 0,
    };
  });
  const dayMap = new Map(days.map((item) => [item.date, item]));

  for (const session of sessions) {
    const dateKey = formatLocalDate(session.started_at);
    const target = dayMap.get(dateKey);
    if (target) {
      target.watchSeconds += Math.max(0, session.watch_seconds || 0);
    }
  }

  return days;
}

export function buildPlaybackDailyRanges(
  now = Date.now(),
): PlaybackTimeRange[] {
  const todayStart = startOfLocalDay(now);
  return Array.from({ length: 7 }, (_, index) => {
    const dayStart = todayStart - (6 - index) * DAY_MS;
    return {
      key: formatLocalDate(dayStart),
      start: dayStart,
      end: dayStart + DAY_MS,
    };
  });
}

export function buildPlaybackDailyStatsFromTotals(
  ranges: PlaybackTimeRange[],
  totals: PlaybackRangeWatchTotal[],
): PlaybackDailyStat[] {
  const totalMap = new Map(totals.map((item) => [item.key, item.watchSeconds]));
  return ranges.map((range) => ({
    date: range.key,
    watchSeconds: Math.max(0, Math.floor(totalMap.get(range.key) || 0)),
  }));
}

function buildTopItems(sessions: PlaybackSession[]): PlaybackTopItem[] {
  const grouped = new Map<string, PlaybackTopItem>();

  for (const session of sessions) {
    const key =
      normalizePlaybackTitleKey(session.title) ||
      `${session.source}+${session.video_id}`;
    const lastWatchedAt = session.ended_at || session.started_at;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        source: session.source,
        videoId: session.video_id,
        title: session.title,
        sourceName: session.source_name,
        cover: session.cover,
        year: session.year,
        watchSeconds: Math.max(0, session.watch_seconds || 0),
        sessionCount: 1,
        lastWatchedAt,
      });
      continue;
    }

    existing.watchSeconds += Math.max(0, session.watch_seconds || 0);
    existing.sessionCount += 1;
    if (lastWatchedAt >= existing.lastWatchedAt) {
      existing.source = session.source;
      existing.videoId = session.video_id;
      existing.title = session.title;
      existing.sourceName = session.source_name;
      existing.cover = session.cover;
      existing.year = session.year;
      existing.lastWatchedAt = lastWatchedAt;
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.watchSeconds - a.watchSeconds)
    .slice(0, 6);
}

export function buildPlaybackStatsSummary(
  sessions: PlaybackSession[],
  now = Date.now(),
): PlaybackStatsSummary {
  const weekStart = startOfLocalDay(now) - 6 * DAY_MS;
  const weekSessions = sessions.filter(
    (session) => session.started_at >= weekStart,
  );
  const totalWatchSeconds = sessions.reduce(
    (sum, session) => sum + Math.max(0, session.watch_seconds || 0),
    0,
  );
  const weekWatchSeconds = weekSessions.reduce(
    (sum, session) => sum + Math.max(0, session.watch_seconds || 0),
    0,
  );

  return {
    totalWatchSeconds,
    weekWatchSeconds,
    dailyWatchSeconds: buildPlaybackDailyStats(weekSessions, now),
    recentItems: dedupePlaybackSessionsByTitle(
      filterPlaybackHistorySessions(sessions),
      6,
    ),
    topItems: buildTopItems(sessions),
  };
}

export function buildPlaybackStatsSummaryFromParts({
  totalWatchSeconds,
  weekWatchSeconds,
  dailyWatchSeconds,
  recentItems,
  topItems,
}: {
  totalWatchSeconds: number;
  weekWatchSeconds: number;
  dailyWatchSeconds: PlaybackDailyStat[];
  recentItems: PlaybackSession[];
  topItems: PlaybackTopItem[];
}): PlaybackStatsSummary {
  return {
    totalWatchSeconds: Math.max(0, Math.floor(totalWatchSeconds || 0)),
    weekWatchSeconds: Math.max(0, Math.floor(weekWatchSeconds || 0)),
    dailyWatchSeconds,
    recentItems: dedupePlaybackSessionsByTitle(
      filterPlaybackHistorySessions(recentItems),
      6,
    ),
    topItems: topItems.slice(0, 6),
  };
}

export function getPlaybackStatsWeekStart(now = Date.now()): number {
  return startOfLocalDay(now) - 6 * DAY_MS;
}
