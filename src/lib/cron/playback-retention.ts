import { db } from '@/lib/db';

const DEFAULT_PLAYBACK_STATS_RETENTION_DAYS = 0;
const MAX_PLAYBACK_STATS_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupPlaybackSessions(): Promise<void> {
  const retentionDays = readPlaybackStatsRetentionDays();
  if (retentionDays <= 0) {
    return;
  }

  const cutoff = Date.now() - retentionDays * DAY_MS;
  const deleted = await db.deletePlaybackSessionsBefore(cutoff);
  if (deleted > 0) {
    console.log(
      `播放统计清理完成：删除 ${deleted} 条超过 ${retentionDays} 天且未更新的会话`,
    );
  }
}

function readPlaybackStatsRetentionDays(): number {
  const parsed = Number.parseInt(
    process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS || '',
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PLAYBACK_STATS_RETENTION_DAYS;
  }
  return Math.min(parsed, MAX_PLAYBACK_STATS_RETENTION_DAYS);
}
