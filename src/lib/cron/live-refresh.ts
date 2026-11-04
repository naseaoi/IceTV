import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { getConfigForRead } from '@/lib/config';

export async function refreshConfiguredLiveChannels(): Promise<void> {
  const config = await getConfigForRead();
  if (!isLiveEntryEnabledInConfig(config)) {
    return;
  }

  await refreshLiveChannelSources(config.LiveConfig || []);
}
