import { useEffect, useState } from 'react';

import { withAbortableTimeout } from '@/lib/concurrency';
import type {
  SourceHealthDailyPoint,
  SourceHealthDailyStatus,
  SourceHealthPublicItem,
  SourceHealthPublicTier,
} from '@/lib/source-quality-policy';

// 与服务端报告缓存同周期，更频繁请求拿不到新数据
const SUMMARY_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 3_000;

export type SourceHealthSummary = Readonly<
  Record<string, SourceHealthPublicItem>
>;

const PUBLIC_TIERS: ReadonlySet<string> = new Set<SourceHealthPublicTier>([
  'good',
  'normal',
  'poor',
  'offline',
]);
const DAILY_STATUSES: ReadonlySet<string> = new Set<SourceHealthDailyStatus>([
  'ok',
  'degraded',
  'down',
  'none',
]);

let cached: { value: SourceHealthSummary; expiresAt: number } | null = null;
let inflight: Promise<SourceHealthSummary> | null = null;

function readRate(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && value >= 0 && value <= 1
    ? value
    : undefined;
}

function readDaily(value: unknown): SourceHealthDailyPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points: SourceHealthDailyPoint[] = [];
  for (const point of value) {
    if (
      !point ||
      typeof point.date !== 'string' ||
      !DAILY_STATUSES.has(point.status)
    )
      return null;
    points.push({ date: point.date, status: point.status });
  }
  return points;
}

function readItem(value: unknown): SourceHealthPublicItem | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const playAvailability = readRate(record.playAvailability);
  const smoothRate = readRate(record.smoothRate);
  const searchAvailability = readRate(record.searchAvailability);
  const daily = readDaily(record.daily);
  if (
    typeof record.tier !== 'string' ||
    !PUBLIC_TIERS.has(record.tier) ||
    playAvailability === undefined ||
    smoothRate === undefined ||
    searchAvailability === undefined ||
    !daily ||
    (record.lastOkDate !== null && typeof record.lastOkDate !== 'string')
  )
    return null;
  return {
    tier: record.tier as SourceHealthPublicTier,
    playAvailability,
    smoothRate,
    searchAvailability,
    lastOkDate: record.lastOkDate,
    daily,
  };
}

async function requestSummary(): Promise<SourceHealthSummary | null> {
  try {
    return await withAbortableTimeout(
      async (signal) => {
        const response = await fetch('/api/source-health', { signal });
        if (!response.ok) return null;
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !('items' in data)) {
          return null;
        }
        const items = data.items;
        if (!items || typeof items !== 'object' || Array.isArray(items)) {
          return null;
        }
        const summary: Record<string, SourceHealthPublicItem> = {};
        for (const [source, raw] of Object.entries(items)) {
          const item = readItem(raw);
          if (item) {
            Object.defineProperty(summary, source, {
              value: item,
              enumerable: true,
            });
          }
        }
        return summary;
      },
      REQUEST_TIMEOUT_MS,
      'Source health request timed out',
    );
  } catch {
    return null;
  }
}

export function peekSourceHealthSummary(): SourceHealthSummary {
  return cached?.value ?? {};
}

// 失败不缓存：徽标只是参考信息，下次打开面板再取
export function loadSourceHealthSummary(): Promise<SourceHealthSummary> {
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }
  if (!inflight) {
    inflight = requestSummary()
      .then((value) => {
        if (!value) return peekSourceHealthSummary();
        cached = { value, expiresAt: Date.now() + SUMMARY_TTL_MS };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useSourceHealthSummary(enabled: boolean): SourceHealthSummary {
  const [summary, setSummary] = useState(peekSourceHealthSummary);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadSourceHealthSummary().then((value) => {
      if (active) setSummary(value);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return summary;
}

export function resetSourceHealthSummaryForTests(): void {
  cached = null;
  inflight = null;
}
