import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { getConfig, saveConfig } from '@/lib/config';

export async function refreshConfiguredLiveChannels(): Promise<void> {
  const config = await getConfig();
  if (!isLiveEntryEnabledInConfig(config)) {
    return;
  }

  await refreshLiveChannelSources(config.LiveConfig || []);
  await saveConfig(config);
}
