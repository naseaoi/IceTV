import 'server-only';

import { randomUUID } from 'node:crypto';

import type { LiveChannel, LiveLineHealth } from '@/features/live/types';
import { withTimeout } from '@/lib/concurrency';
import { db } from '@/lib/db';

import { LIVE_HEALTH_POLICY as POLICY } from './liveHealthPolicy';

export interface LiveHealthSnapshot {
  lines: Record<string, LiveLineHealth>;
}
export const liveHealthSnapshotKey = (sourceKey: string) =>
  `live-health:v1:${sourceKey}`;

export async function readLiveHealthSnapshot(
  sourceKey: string,
): Promise<LiveHealthSnapshot> {
  const record = await withTimeout(
    db.getSharedCache(liveHealthSnapshotKey(sourceKey)),
    POLICY.snapshotReadWaitMs,
    'Live health snapshot read timed out',
  );
  if (!record?.value || record.staleUntil <= Date.now()) return { lines: {} };
  const parsed = JSON.parse(record.value) as LiveHealthSnapshot;
  if (!parsed?.lines || typeof parsed.lines !== 'object')
    throw new Error('Invalid live health snapshot');
  return parsed;
}

export function pruneLiveHealthSnapshot(
  snapshot: LiveHealthSnapshot,
  channels: LiveChannel[],
): LiveHealthSnapshot {
  const ids = new Set(channels.map((channel) => channel.lineId));
  return {
    lines: Object.fromEntries(
      Object.entries(snapshot.lines).filter(([id]) => ids.has(id)),
    ),
  };
}

export function isLiveHealthDue(
  health: LiveLineHealth | undefined,
  now = Date.now(),
): boolean {
  return !health?.checkedAt || now - health.checkedAt >= POLICY.refreshMs;
}

export function displayLiveHealth(
  health: LiveLineHealth | undefined,
  now = Date.now(),
): LiveLineHealth {
  if (!health) return { status: 'unknown' };
  if (!health.checkedAt || now - health.checkedAt >= POLICY.unknownAfterMs) {
    return {
      status: 'unknown',
      ...(health.checkedAt ? { checkedAt: health.checkedAt } : {}),
    };
  }
  return health;
}

export async function attachLiveHealth(
  sourceKey: string,
  channels: LiveChannel[],
): Promise<LiveChannel[]> {
  const snapshot = await readLiveHealthSnapshot(sourceKey);
  return channels.map((channel) => ({
    ...channel,
    health: displayLiveHealth(snapshot.lines[channel.lineId]),
  }));
}

// 只读入口不使用 getOrLoad：频道读取绝不能隐式触发探测或续期快照。
// 使用 shared-server-cache 同一组数据库原语，逐条落盘且保持 token / 空占位行释放语义。
export async function writeLiveHealthSnapshot(
  sourceKey: string,
  snapshot: LiveHealthSnapshot,
): Promise<void> {
  const value = JSON.stringify(snapshot);
  if (Buffer.byteLength(value) > POLICY.snapshotMaxBytes)
    throw new Error('Live health snapshot too large');
  const key = liveHealthSnapshotKey(sourceKey);
  const token = randomUUID();
  const now = Date.now();
  if (
    !(await db.acquireSharedCacheLease(key, token, now, now + POLICY.leaseMs))
  )
    throw new Error('Live health snapshot is locked');
  let persisted = false;
  try {
    persisted = await db.setSharedCache(
      key,
      token,
      value,
      now + POLICY.refreshMs,
      now + POLICY.snapshotRetentionMs,
      now,
    );
    if (!persisted) throw new Error('Live health snapshot lease lost');
  } finally {
    if (!persisted) await db.releaseSharedCacheLease(key, token);
  }
}
