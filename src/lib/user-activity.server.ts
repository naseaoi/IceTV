import 'server-only';

import { db } from '@/lib/db';

const THROTTLE_MS = 5 * 60_000;
const MAX_TRACKED_USERS = 5000;

const lastWriteAt = new Map<string, number>();

function prune(now: number): void {
  if (lastWriteAt.size <= MAX_TRACKED_USERS) return;
  for (const [username, writtenAt] of lastWriteAt) {
    if (now - writtenAt >= THROTTLE_MS) {
      lastWriteAt.delete(username);
    }
  }
}

// 同一用户 5 分钟内只落库一次，不阻塞请求
export function touchUserActivity(username: string, now = Date.now()): void {
  if (!username) return;

  const writtenAt = lastWriteAt.get(username);
  if (writtenAt !== undefined && now - writtenAt < THROTTLE_MS) return;

  lastWriteAt.set(username, now);
  prune(now);

  void db.recordUserActivity(username, now).catch((error) => {
    lastWriteAt.delete(username);
    console.warn('记录用户活跃时间失败:', error);
  });
}

export function resetUserActivityThrottle(): void {
  lastWriteAt.clear();
}
