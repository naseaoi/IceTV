import type { PlaybackSession } from '@/lib/types';

function normalizePlaybackTitleKey(title: string): string {
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

export function dedupePlaybackSessionsByTitle(
  sessions: PlaybackSession[],
  limit?: number,
): PlaybackSession[] {
  const grouped = new Map<string, PlaybackSession>();

  for (const session of sessions) {
    const key = getPlaybackSessionMergeKey(session);
    const existing = grouped.get(key);
    if (
      !existing ||
      getPlaybackSessionTime(session) >= getPlaybackSessionTime(existing)
    ) {
      grouped.set(key, session);
    }
  }

  const deduped = Array.from(grouped.values()).sort(
    (a, b) => getPlaybackSessionTime(b) - getPlaybackSessionTime(a),
  );

  return typeof limit === 'number' ? deduped.slice(0, limit) : deduped;
}
