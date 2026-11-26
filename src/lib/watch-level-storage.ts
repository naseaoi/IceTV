import type { PlaybackSession } from '@/lib/types';
import { WATCH_LEVELS, watchLevelForMs } from '@/lib/watch-level';
import type { WatchLevelEvent, WatchLevelUp } from '@/lib/watch-level-types';

export type WatchLevelEventRow = {
  level: WatchLevelEvent['level'];
  reached_at: number;
  title: string;
  year: string;
  episode_index: number;
  source: string;
  video_id: string;
};

export function mapWatchLevelEvent(row: WatchLevelEventRow): WatchLevelEvent {
  return {
    level: Number(row.level) as WatchLevelEvent['level'],
    reachedAt: Number(row.reached_at),
    title: row.title,
    year: row.year,
    episodeIndex: Number(row.episode_index),
    source: row.source,
    videoId: row.video_id,
  };
}

export function newlyReachedLevels(before: number, after: number) {
  return WATCH_LEVELS.filter(
    (item) => item.minMs > before && item.minMs <= after,
  );
}

export function levelUpForDelta(before: number, delta: number): WatchLevelUp {
  const level = watchLevelForMs(before + delta);
  return level > watchLevelForMs(before) ? { level } : null;
}

export function levelEventValues(
  username: string,
  level: number,
  reachedAt: number,
  session: Pick<
    PlaybackSession,
    'source' | 'video_id' | 'title' | 'year' | 'episode_index'
  >,
) {
  return [
    username,
    level,
    reachedAt,
    session.source,
    session.video_id,
    session.title,
    session.year,
    session.episode_index,
  ];
}

export const WATCH_LEVEL_EVENT_INSERT = `INSERT INTO user_level_events
  (username, level, reached_at, source, video_id, title, year, episode_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
