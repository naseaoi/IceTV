import { db } from '@/lib/db';
import { cleanupSourceHealth } from '@/lib/source-health.server';

import { refreshSubscribedConfig } from './config-refresh';
import { cleanupInviteCodes } from './invite-code-retention';
import { refreshConfiguredLiveChannels } from './live-refresh';
import { refreshRecordAndFavorites } from './metadata-refresh';
import { cleanupPlaybackSessions } from './playback-retention';
import { probeConfiguredSources } from './source-health';
import type { CronTask } from './types';

// 后台最多读取 30 天，额外保留一周余量。
const SOURCE_ROUTE_STATS_RETENTION_DAYS = 37;

export async function executeCronTask(task: CronTask): Promise<void> {
  if (task === 'all' || task === 'config') {
    await refreshSubscribedConfig();
  }
  if (task === 'all' || task === 'live') {
    await refreshConfiguredLiveChannels();
  }
  if (task === 'all' || task === 'metadata') {
    await refreshRecordAndFavorites();
    await cleanupPlaybackSessions();
    await cleanupInviteCodes();
    await cleanupSourceHealth();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - SOURCE_ROUTE_STATS_RETENTION_DAYS);
    await db.purgeSourceRouteStatsBefore(cutoff.toISOString().slice(0, 10));
  }
  // Existing production and development schedulers both dispatch metadata.
  if (task === 'all' || task === 'metadata' || task === 'source-health') {
    await probeConfiguredSources();
  }
}
