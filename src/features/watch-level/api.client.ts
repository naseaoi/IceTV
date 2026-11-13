import { fetchWithAuth } from '@/lib/db.client.internal';
import { isWatchLevel } from '@/lib/watch-level';
import type { WatchLevelResponse } from '@/lib/watch-level-types';

export async function fetchMyWatchLevel(): Promise<WatchLevelResponse> {
  const response = await fetchWithAuth('/api/me/watch-level');
  const data = (await response.json()) as WatchLevelResponse;
  if (!isWatchLevel(data.level)) throw new Error('Invalid watch level');
  return data;
}
