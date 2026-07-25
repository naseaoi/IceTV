import { refreshSubscribedConfig } from './config-refresh';
import { refreshConfiguredLiveChannels } from './live-refresh';
import { refreshRecordAndFavorites } from './metadata-refresh';
import { cleanupPlaybackSessions } from './playback-retention';
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
  }
}
