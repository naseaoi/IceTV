import type { PlaybackSession } from '@/lib/types';
import {
  WATCH_LEVEL_BUCKET_CAP_MS,
  WATCH_LEVELS,
  watchLevelForMs,
} from '@/lib/watch-level';
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

// v2 同桶用最后结束的会话提供作品信息；并列时按 id 排序，两个后端回填结果一致。
export const watchLevelBackfillSql = `SELECT username, source, video_id, title, year, episode_index,
  CASE WHEN counted_ms > ${WATCH_LEVEL_BUCKET_CAP_MS} THEN ${WATCH_LEVEL_BUCKET_CAP_MS} ELSE counted_ms END AS counted_ms,
  reached_at, sort_at, tie_id FROM (
  SELECT b.username, s.source, s.video_id, s.title, s.year, s.episode_index,
    SUM(b.watch_ms) OVER (PARTITION BY b.username, b.bucket_start) AS counted_ms,
    b.bucket_start + ${WATCH_LEVEL_BUCKET_CAP_MS} AS reached_at, b.bucket_start AS sort_at, s.id AS tie_id,
    ROW_NUMBER() OVER (PARTITION BY b.username, b.bucket_start ORDER BY s.ended_at DESC, s.id DESC) AS row_num
  FROM playback_watch_buckets b JOIN playback_sessions s ON s.id = b.session_id AND s.username = b.username
  WHERE s.measurement_version = 2 AND b.watch_ms > 0
) ranked WHERE row_num = 1
UNION ALL
SELECT username, source, video_id, title, year, episode_index, watch_seconds * 1000 AS counted_ms,
  ended_at AS reached_at, started_at AS sort_at, id AS tie_id
FROM playback_sessions WHERE measurement_version = 1 AND watch_seconds > 0
ORDER BY username, sort_at, tie_id`;

export type WatchLevelBackfillRow = Pick<
  PlaybackSession,
  'source' | 'video_id' | 'title' | 'year' | 'episode_index'
> & {
  username: string;
  counted_ms: number;
  reached_at: number;
  sort_at: number;
  tie_id: string;
};
