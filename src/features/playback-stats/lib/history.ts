import type { PlaybackSession } from '@/lib/types';

type DedupePlaybackSessionsOptions = {
  limit?: number;
  mergeWatchSeconds?: boolean;
};

type PlaybackSessionGroup = {
  session: PlaybackSession;
  watchSeconds: number;
  ids: Set<string>;
};

export function normalizePlaybackTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizePlaybackSourceKey(session: PlaybackSession): string {
  return (session.source || session.source_name)
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function getPlaybackSessionTime(session: PlaybackSession): number {
  return (
    session.started_at ||
    session.ended_at ||
    session.updated_at ||
    session.created_at ||
    0
  );
}

export function getPlaybackSessionMergeKey(session: PlaybackSession): string {
  const titleKey = normalizePlaybackTitleKey(session.title);
  if (!titleKey) return session.id;
  return `${normalizePlaybackSourceKey(session)}+${titleKey}`;
}

export function filterPlaybackHistorySessions(
  sessions: PlaybackSession[],
): PlaybackSession[] {
  return sessions.filter(
    (session) => Math.max(0, session.watch_seconds || 0) > 0,
  );
}

export function dedupePlaybackSessionsByTitle(
  sessions: PlaybackSession[],
  options?: number | DedupePlaybackSessionsOptions,
): PlaybackSession[] {
  const limit = typeof options === 'number' ? options : options?.limit;
  const mergeWatchSeconds =
    typeof options === 'number' ? false : options?.mergeWatchSeconds === true;
  const grouped = new Map<string, PlaybackSessionGroup>();

  for (const session of sessions) {
    const key = getPlaybackSessionMergeKey(session);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        session,
        watchSeconds: Math.max(0, session.watch_seconds || 0),
        ids: new Set([session.id]),
      });
      continue;
    }

    if (!existing.ids.has(session.id)) {
      existing.watchSeconds += Math.max(0, session.watch_seconds || 0);
      existing.ids.add(session.id);
    }

    if (
      getPlaybackSessionTime(session) >=
      getPlaybackSessionTime(existing.session)
    ) {
      existing.session = session;
    }
  }

  const deduped = Array.from(grouped.values()).map((group) =>
    mergeWatchSeconds
      ? {
          ...group.session,
          watch_seconds: group.watchSeconds,
        }
      : group.session,
  );

  deduped.sort((a, b) => getPlaybackSessionTime(b) - getPlaybackSessionTime(a));

  return typeof limit === 'number' ? deduped.slice(0, limit) : deduped;
}

export interface PlaybackSessionDayGroup {
  key: string;
  label: string;
  sessions: PlaybackSession[];
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDayLabel(dayStart: number, todayStart: number): string {
  if (dayStart === todayStart) return '今天';
  if (dayStart === startOfLocalDay(todayStart - 1)) return '昨天';
  const date = new Date(dayStart);
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(todayStart).getFullYear()
    ? monthDay
    : `${date.getFullYear()}年${monthDay}`;
}

// 按本地日期分组，保持传入顺序（调用方已按时间倒序）
export function groupPlaybackSessionsByDay(
  sessions: PlaybackSession[],
  now = Date.now(),
): PlaybackSessionDayGroup[] {
  const todayStart = startOfLocalDay(now);
  const groups = new Map<number, PlaybackSessionDayGroup>();

  for (const session of sessions) {
    const dayStart = startOfLocalDay(getPlaybackSessionTime(session));
    let group = groups.get(dayStart);
    if (!group) {
      group = {
        key: String(dayStart),
        label: formatDayLabel(dayStart, todayStart),
        sessions: [],
      };
      groups.set(dayStart, group);
    }
    group.sessions.push(session);
  }

  return Array.from(groups.values());
}
