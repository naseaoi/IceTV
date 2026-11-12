import 'server-only';

import { db } from '@/lib/db';
import { createSharedServerCache } from '@/lib/shared-server-cache';

import type { PlaybackSourceUsage } from './source-usage';

const cache = createSharedServerCache<PlaybackSourceUsage[]>({
  name: 'playback-source-usage-v1',
  freshMs: 300_000,
  staleMs: 300_000,
  maxSize: 200,
});

// 全站查询没有用户名索引前缀，五分钟共享缓存限制整表范围扫描频率。
export function getPlaybackSourceUsage(
  days: number,
  username?: string,
): Promise<PlaybackSourceUsage[]> {
  return cache.getOrLoad(JSON.stringify([username ?? null, days]), () => {
    const end = Date.now();
    return db.getPlaybackSourceUsage(end - days * 86_400_000, end, username);
  });
}
