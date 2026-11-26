import 'server-only';

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import {
  type ProxyFailureDiagnostic,
  toSourceProxyFailureReason,
} from '@/lib/proxy-diagnostics';
import {
  SOURCE_HEALTH_FLUSH_INTERVAL_MS,
  SOURCE_ROUTE_STATS_RETENTION_DAYS,
} from '@/lib/source-quality-policy';
import type { SourceProxyFailureDelta } from '@/lib/types';

const MAX_PENDING_ENTRIES = 4096;
let pending = new Map<string, SourceProxyFailureDelta>();
let pendingCutoff = '';
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

function prunePending(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - SOURCE_ROUTE_STATS_RETENTION_DAYS);
  const cutoff = date.toISOString().slice(0, 10);
  if (cutoff !== pendingCutoff) {
    for (const [key, row] of pending) {
      if (row.bucketDate < cutoff) pending.delete(key);
    }
    pendingCutoff = cutoff;
  }
  return cutoff;
}

function mergeDelta(row: SourceProxyFailureDelta): void {
  if (row.bucketDate < prunePending()) return;
  const key = JSON.stringify([row.source, row.bucketDate, row.reason]);
  const current = pending.get(key);
  if (current) {
    current.failureCount += row.failureCount;
    return;
  }
  if (pending.size >= MAX_PENDING_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestDate = row.bucketDate;
    for (const [candidateKey, candidate] of pending) {
      if (candidate.bucketDate <= oldestDate) {
        oldestKey = candidateKey;
        oldestDate = candidate.bucketDate;
      }
    }
    if (oldestKey === undefined) return;
    pending.delete(oldestKey);
  }
  pending.set(key, { ...row });
}

function scheduleFlush(): void {
  if (timer || inFlight || !pending.size) return;
  timer = setTimeout(() => {
    timer = null;
    void flushSourceProxyFailures();
  }, SOURCE_HEALTH_FLUSH_INTERVAL_MS);
  timer.unref?.();
}

export function recordSourceProxyFailure(
  diagnostic: ProxyFailureDiagnostic,
): void {
  const reason = toSourceProxyFailureReason(diagnostic);
  if (!reason) return;
  mergeDelta({
    source: diagnostic.source!.trim().slice(0, 191),
    bucketDate: new Date().toISOString().slice(0, 10),
    reason,
    failureCount: 1,
  });
  scheduleFlush();
}

export function flushSourceProxyFailures(): Promise<void> {
  if (inFlight) return inFlight;
  if (timer) clearTimeout(timer);
  timer = null;
  prunePending();
  if (!pending.size) return Promise.resolve();
  const batch = [...pending.values()];
  pending = new Map();
  // 延后执行同步存储驱动，让失败采样保持非阻塞。
  inFlight = Promise.resolve()
    .then(async () => {
      // 代理鉴权不拒绝未配置的源标识，按当前配置过滤，防止任意 key 写入存储
      const config = await getConfigForRead();
      const known = new Set(config.SourceConfig.map((source) => source.key));
      const rows = batch.filter((row) => known.has(row.source));
      if (rows.length) await db.recordSourceProxyFailureBatch(rows);
    })
    .catch((error) => {
      for (const row of batch) mergeDelta(row);
      console.warn('Failed to flush source proxy failures', error);
    })
    .finally(() => {
      inFlight = null;
      scheduleFlush();
    });
  return inFlight;
}

export function resetSourceProxyFailuresForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = new Map();
  pendingCutoff = '';
  inFlight = null;
}
