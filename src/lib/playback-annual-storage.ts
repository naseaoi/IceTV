// 两侧存储共用范围谓词；旧会话按起播后的连续估算时长与区间相交。
export const ANNUAL_SESSIONS_SQL = `SELECT id, source, video_id, episode_index, title, source_name, cover, year,
  started_at, ended_at, watch_seconds, measurement_version
FROM playback_sessions
WHERE username = ? AND started_at < ? AND measurement_version = 1
  AND watch_seconds > 0 AND started_at + watch_seconds * 1000 > ?
UNION ALL
SELECT s.id, s.source, s.video_id, s.episode_index, s.title, s.source_name, s.cover, s.year,
  s.started_at, s.ended_at, s.watch_seconds, s.measurement_version
FROM playback_sessions s
INNER JOIN (
  SELECT DISTINCT session_id FROM playback_watch_buckets
  WHERE username = ? AND bucket_start >= ? AND bucket_start < ?
) b ON b.session_id = s.id
WHERE s.username = ? AND s.measurement_version = 2 AND s.watch_seconds > 0`;

export const ANNUAL_BUCKETS_SQL = `SELECT session_id, bucket_start, watch_ms
FROM playback_watch_buckets
WHERE username = ? AND bucket_start >= ? AND bucket_start < ?`;

// 消息资格只需确认当年有正时长会话，复用 (username, started_at) 范围索引。
export const ANNUAL_MESSAGE_EXISTS_SQL = `SELECT 1 FROM playback_sessions
WHERE username = ? AND started_at >= ? AND started_at < ? AND watch_seconds > 0 LIMIT 1`;

export const ANNUAL_EARLIEST_SQL = `SELECT started_at FROM playback_sessions
WHERE username = ? AND watch_seconds > 0 ORDER BY started_at ASC LIMIT 1`;
