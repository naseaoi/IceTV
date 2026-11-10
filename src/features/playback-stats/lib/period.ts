import type {
  PlaybackPeriodStats,
  PlaybackTopWork,
} from '@/features/playback-stats/types';
import { PLAYBACK_TOP_WORKS_LIMIT } from '@/features/playback-stats/types';
import type { PlaybackAnnualData, PlaybackPeriodSession } from '@/lib/types';

import { visitWatchIntervals } from './watch-intervals';
import { playbackWorkIdentity } from './work-identity';

const DAY_MS = 86_400_000;

export class PlaybackPeriodValidationError extends Error {}

export function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new PlaybackPeriodValidationError('时区无效');
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function localDate(
  formatter: Intl.DateTimeFormat,
  instant: number,
): string {
  const parts = formatter.formatToParts(instant);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// 在目标日期附近定位本地日历日的起点；午夜跳时也以该日首个有效时刻为界。
export function localMidnight(
  date: Date,
  formatter: Intl.DateTimeFormat,
): number {
  const target = date.getTime();
  let low = target - 2 * DAY_MS;
  let high = target + 2 * DAY_MS;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDate(localDate(formatter, middle)).getTime() < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function buildPlaybackPeriod(
  input: {
    type?: string | null;
    date?: string | null;
    timeZone?: string | null;
  },
  now = Date.now(),
): PlaybackPeriodStats {
  const type = input.type ?? 'week';
  if (type !== 'week' && type !== 'month' && type !== 'year') {
    throw new PlaybackPeriodValidationError('统计周期无效');
  }
  const timeZone = input.timeZone ?? 'UTC';
  const formatter = dateFormatter(timeZone);
  const date = input.date ?? localDate(formatter, now);
  const anchor = calendarDate(date);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(anchor.getTime()) ||
    anchor.toISOString().slice(0, PLAYBACK_TOP_WORKS_LIMIT) !== date
  ) {
    throw new PlaybackPeriodValidationError('日期无效');
  }
  const cursor = new Date(anchor);
  if (type === 'week') {
    cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  } else {
    cursor.setUTCDate(1);
    if (type === 'year') cursor.setUTCMonth(0);
  }
  const endDate = new Date(cursor);
  if (type === 'week') endDate.setUTCDate(endDate.getUTCDate() + 7);
  else if (type === 'month') endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  else endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);

  const buckets: PlaybackPeriodStats['buckets'] = [];
  let start = localMidnight(cursor, formatter);
  while (cursor < endDate) {
    const key = cursor.toISOString().slice(0, type === 'year' ? 7 : 10);
    if (type === 'year') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
    const end = localMidnight(cursor, formatter);
    buckets.push({ key, start, end, watchSeconds: 0 });
    start = end;
  }
  return {
    type,
    date,
    timeZone,
    start: buckets[0].start,
    end: buckets[buckets.length - 1].end,
    watchSeconds: 0,
    activeDays: 0,
    hours: Array<number>(24).fill(0),
    currentStreak: 0,
    lifetimeWatchSeconds: 0,
    buckets,
    topWorks: [],
  };
}

export function aggregatePlaybackPeriod(
  period: PlaybackPeriodStats,
  sessions: PlaybackPeriodSession[],
  lifetimeWatchSeconds: number,
): PlaybackPeriodStats {
  const buckets = period.buckets.map((bucket) => ({
    ...bucket,
    watchSeconds: 0,
  }));
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const formatter = dateFormatter(period.timeZone);
  const activeDays = new Set<string>();
  const works = new Map<string, PlaybackTopWork>();
  let watchSeconds = 0;
  const episodes = new Map<string, Set<number>>();

  for (const session of sessions) {
    // 与历史记录一致：未产生观看时长的会话不参与统计。
    if (
      !(session.watch_seconds > 0) ||
      session.started_at < period.start ||
      session.started_at >= period.end
    )
      continue;
    const day = localDate(formatter, session.started_at);
    const bucket = bucketMap.get(
      period.type === 'year' ? day.slice(0, 7) : day,
    );
    if (!bucket) continue;
    bucket.watchSeconds += session.watch_seconds;
    watchSeconds += session.watch_seconds;
    activeDays.add(day);

    const key = playbackWorkIdentity(session);
    const watched = episodes.get(key) ?? new Set<number>();
    watched.add(session.episode_index);
    episodes.set(key, watched);
    const lastWatchedAt = Math.max(session.started_at, session.ended_at);
    const existing = works.get(key);
    const representative = {
      title: session.title,
      year: session.year,
      cover: session.cover,
      source: session.source,
      videoId: session.video_id,
      lastWatchedAt,
    };
    if (!existing) {
      works.set(key, {
        ...representative,
        watchSeconds: session.watch_seconds,
        sessionCount: 1,
        episodeCount: watched.size,
      });
    } else {
      existing.watchSeconds += session.watch_seconds;
      existing.sessionCount += 1;
      existing.episodeCount = watched.size;
      if (lastWatchedAt > existing.lastWatchedAt)
        Object.assign(existing, representative);
    }
  }
  return {
    ...period,
    buckets,
    watchSeconds,
    activeDays: activeDays.size,
    lifetimeWatchSeconds,
    topWorks: Array.from(works.values())
      .sort(
        (a, b) =>
          b.watchSeconds - a.watchSeconds || b.lastWatchedAt - a.lastWatchedAt,
      )
      .slice(0, PLAYBACK_TOP_WORKS_LIMIT),
  };
}

export function playbackStreakRange(timeZone: string, now = Date.now()) {
  const formatter = dateFormatter(timeZone);
  const today = calendarDate(localDate(formatter, now));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 366);
  return { start: localMidnight(start, formatter), end: now + 1 };
}

export function aggregatePlaybackRhythm(
  data: PlaybackAnnualData,
  period: Pick<PlaybackPeriodStats, 'start' | 'end' | 'timeZone'>,
): { hours: number[]; days: Set<string> } {
  const hours = Array<number>(24).fill(0);
  const days = new Set<string>();
  const formatter = dateFormatter(period.timeZone);
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: period.timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  visitWatchIntervals(data, period.start, period.end, (_session, at, ms) => {
    hours[Number(hourFormatter.format(at))] += ms;
    days.add(localDate(formatter, at));
  });
  return { hours: hours.map((ms) => Math.floor(ms / 1000)), days };
}

export function currentPlaybackStreak(
  days: Set<string>,
  timeZone: string,
  now = Date.now(),
): number {
  const cursor = calendarDate(localDate(dateFormatter(timeZone), now));
  if (!days.has(cursor.toISOString().slice(0, 10)))
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (streak < 366 && days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
