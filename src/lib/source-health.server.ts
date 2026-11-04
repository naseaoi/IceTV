import 'server-only';

import { createHmac } from 'crypto';

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { getAuthSigningSecret } from '@/lib/signing-secret.server';
import {
  type SourceHealthReportItem,
  type SourceHealthTier,
  normalizeSourceHealthDays,
  scoreSourceHealth,
  SOURCE_HEALTH_DEFAULT_DAYS,
  SOURCE_HEALTH_FLUSH_INTERVAL_MS,
  SOURCE_HEALTH_RETENTION_DAYS,
  SOURCE_HEALTH_TIERS_CACHE_TTL_MS,
} from '@/lib/source-quality-policy';
import type {
  SourceHealthSearchDaily,
  SourceHealthSearchDelta,
} from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

export type SourceSearchOutcome = 'ok' | 'empty' | 'error';

let pending = new Map<string, SourceHealthSearchDelta>();
let lastFlushAt = Date.now();
let inFlight: Promise<void> | null = null;

function mergeDelta(row: SourceHealthSearchDelta): void {
  const key = JSON.stringify([row.source, row.bucketDate]);
  const current = pending.get(key);
  if (!current) {
    pending.set(key, { ...row });
    return;
  }
  current.okCount += row.okCount;
  current.emptyCount += row.emptyCount;
  current.errorCount += row.errorCount;
  current.latencyMsSum += row.latencyMsSum;
  current.latencySamples += row.latencySamples;
}

export function recordSourceSearchOutcome(
  source: string,
  outcome: SourceSearchOutcome,
  latencyMs = 0,
  eventAt = Date.now(),
): void {
  try {
    const hasLatency = outcome !== 'error' && Number.isFinite(latencyMs);
    mergeDelta({
      source,
      bucketDate: new Date(eventAt).toISOString().slice(0, 10),
      okCount: outcome === 'ok' ? 1 : 0,
      emptyCount: outcome === 'empty' ? 1 : 0,
      errorCount: outcome === 'error' ? 1 : 0,
      latencyMsSum: hasLatency ? Math.max(0, latencyMs) : 0,
      latencySamples: hasLatency ? 1 : 0,
    });
    if (Date.now() - lastFlushAt >= SOURCE_HEALTH_FLUSH_INTERVAL_MS) {
      void flushSourceHealthSearch();
    }
  } catch (error) {
    console.warn('Failed to record source search health', error);
  }
}

export function flushSourceHealthSearch(): Promise<void> {
  if (inFlight) return inFlight;
  if (pending.size === 0) return Promise.resolve();

  const batch = [...pending.values()];
  pending = new Map();
  lastFlushAt = Date.now();
  // Defer storage work so recording never waits for a synchronous DB driver.
  inFlight = Promise.resolve()
    .then(() => db.recordSourceHealthSearchBatch(batch))
    .catch((error) => {
      for (const row of batch) mergeDelta(row);
      console.warn('Failed to flush source search health', error);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function resetSourceHealthSearchForTests(): void {
  pending = new Map();
  lastFlushAt = Date.now();
  inFlight = null;
  tiersCache = null;
  tiersInFlight = null;
}

export async function recordSourcePlayOutcome(
  username: string,
  source: string,
  success: boolean,
  eventAt: number,
): Promise<void> {
  const reporter = createHmac('sha256', getAuthSigningSecret())
    .update(`source-health-play:${normalizeUsername(username)}`)
    .digest('hex')
    .slice(0, 16);
  await db.recordSourcePlayReport({
    source,
    bucketDate: new Date(eventAt).toISOString().slice(0, 10),
    reporter,
    success,
  });
}

function utcDateDaysAgo(days: number, now: Date): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function getSourceHealthReport(
  days: number,
): Promise<SourceHealthReportItem[]> {
  await flushSourceHealthSearch();
  const now = new Date();
  const sinceDate = utcDateDaysAgo(normalizeSourceHealthDays(days) - 1, now);
  const retentionDate = utcDateDaysAgo(SOURCE_HEALTH_RETENTION_DAYS, now);
  const [config, searchRows, playWindow, playRetention] = await Promise.all([
    getConfigForRead(),
    db.getSourceHealthSearchDaily(retentionDate),
    db.getSourcePlayReporterSummary(sinceDate),
    db.getSourcePlayReporterSummary(retentionDate),
  ]);
  const searchBySource = new Map<string, SourceHealthSearchDaily[]>();
  const lastOkBySource = new Map<string, string>();
  const setLastOk = (source: string, date: string | null) => {
    if (date && date > (lastOkBySource.get(source) ?? '')) {
      lastOkBySource.set(source, date);
    }
  };
  for (const row of searchRows) {
    if (row.okCount + row.emptyCount > 0) {
      setLastOk(row.source, row.bucketDate);
    }
    if (row.bucketDate >= sinceDate) {
      const rows = searchBySource.get(row.source) ?? [];
      rows.push(row);
      searchBySource.set(row.source, rows);
    }
  }
  for (const row of playRetention) {
    setLastOk(row.source, row.lastSuccessDate);
  }
  const playBySource = new Map(playWindow.map((row) => [row.source, row]));
  return config.SourceConfig.map((source) =>
    scoreSourceHealth(
      source.key,
      searchBySource.get(source.key) ?? [],
      playBySource.get(source.key),
      lastOkBySource.get(source.key) ?? null,
    ),
  );
}

let tiersCache: {
  tiers: Map<string, SourceHealthTier>;
  expiresAt: number;
} | null = null;
let tiersInFlight: Promise<Map<string, SourceHealthTier>> | null = null;

export async function getSourceHealthTiers(): Promise<
  Map<string, SourceHealthTier>
> {
  if (tiersCache && tiersCache.expiresAt > Date.now()) {
    return new Map(tiersCache.tiers);
  }
  if (!tiersInFlight) {
    tiersInFlight = getSourceHealthReport(SOURCE_HEALTH_DEFAULT_DAYS)
      .then((report) => new Map(report.map((item) => [item.source, item.tier])))
      .catch((error) => {
        console.warn('Failed to load source health tiers', error);
        return new Map<string, SourceHealthTier>();
      })
      .then((tiers) => {
        tiersCache = {
          tiers,
          expiresAt: Date.now() + SOURCE_HEALTH_TIERS_CACHE_TTL_MS,
        };
        return tiers;
      })
      .finally(() => {
        tiersInFlight = null;
      });
  }
  return new Map(await tiersInFlight);
}

export async function cleanupSourceHealth(): Promise<void> {
  await db.purgeSourceHealthBefore(
    utcDateDaysAgo(SOURCE_HEALTH_RETENTION_DAYS, new Date()),
  );
}
