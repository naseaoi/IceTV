import { cleanupSourceHealth } from '@/lib/source-health.server';

import { refreshSubscribedConfig } from './config-refresh';
import { cleanupInviteCodes } from './invite-code-retention';
import { refreshConfiguredLiveChannels } from './live-refresh';
import { refreshRecordAndFavorites } from './metadata-refresh';
import { cleanupPlaybackSessions } from './playback-retention';
import { probeConfiguredSources } from './source-health';
import type { CronTask } from './types';

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
  }
  // Existing production and development schedulers both dispatch metadata.
  if (task === 'all' || task === 'metadata' || task === 'source-health') {
    await probeConfiguredSources();
  }
}
