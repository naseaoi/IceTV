import 'server-only';

import { createHmac } from 'crypto';

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { getAuthSigningSecret } from '@/lib/signing-secret.server';
import {
  type EffectiveSmoothDaily,
  type SourceHealthReportItem,
  type SourceHealthTier,
  buildSourceHealthDaily,
  getEffectiveSmoothDaily,
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
  SourcePlayReporterDaily,
  SourcePlayReporterSummary,
  SourceSmoothBreakdownItem,
  SourceSmoothnessPayload,
} from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

export type SourceSearchOutcome = 'ok' | 'empty' | 'error';

const MAX_PENDING_ENTRIES = 4096;
let pending = new Map<string, SourceHealthSearchDelta>();
let pendingCutoff = '';
let lastFlushAt = Date.now();
let inFlight: Promise<void> | null = null;

function prunePending(): string {
  const cutoff = utcDateDaysAgo(SOURCE_HEALTH_RETENTION_DAYS, new Date());
  if (cutoff !== pendingCutoff) {
    for (const [key, row] of pending) {
      if (row.bucketDate < cutoff) pending.delete(key);
    }
    pendingCutoff = cutoff;
  }
  return cutoff;
}

function mergeDelta(row: SourceHealthSearchDelta): void {
  if (row.bucketDate < prunePending()) return;
  const key = JSON.stringify([row.source, row.bucketDate]);
  const current = pending.get(key);
  if (!current) {
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
  prunePending();
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
  pendingCutoff = '';
  lastFlushAt = Date.now();
  inFlight = null;
  reportCache = null;
  reportInFlight = null;
}

function getSourceHealthReporter(username: string): string {
  return createHmac('sha256', getAuthSigningSecret())
    .update(`source-health-play:${normalizeUsername(username)}`)
    .digest('hex')
    .slice(0, 16);
}

export async function recordSourceSmoothness(
  username: string,
  payload: SourceSmoothnessPayload,
): Promise<void> {
  const { eventAt, ...delta } = payload;
  await db.recordSourceSmoothReport({
    ...delta,
    reporter: getSourceHealthReporter(username),
    bucketDate: new Date(eventAt).toISOString().slice(0, 10),
  });
}

export async function recordSourcePlayOutcome(
  username: string,
  source: string,
  success: boolean,
  eventAt: number,
): Promise<void> {
  const reporter = getSourceHealthReporter(username);
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
  const windowDays = normalizeSourceHealthDays(days);
  const dates = Array.from({ length: windowDays }, (_, index) =>
    utcDateDaysAgo(windowDays - index - 1, now),
  );
  const sinceDate = dates[0];
  const retentionDate = utcDateDaysAgo(SOURCE_HEALTH_RETENTION_DAYS, now);
  const [
    config,
    searchRows,
    playWindow,
    playRetention,
    smoothWindow,
    smoothBreakdown,
  ] = await Promise.all([
    getConfigForRead(),
    db.getSourceHealthSearchDaily(retentionDate),
    db.getSourcePlayReporterDaily(sinceDate),
    db.getSourcePlayReporterSummary(retentionDate),
    db.getSourceSmoothReporterDaily(sinceDate),
    db.getSourceSmoothBreakdown(sinceDate),
  ]);
  const smoothBySource = new Map<string, EffectiveSmoothDaily[]>();
  for (const row of getEffectiveSmoothDaily(smoothWindow)) {
    const rows = smoothBySource.get(row.source) ?? [];
    rows.push(row);
    smoothBySource.set(row.source, rows);
  }
  const breakdownBySource = new Map<string, SourceSmoothBreakdownItem[]>();
  for (const row of smoothBreakdown) {
    const rows = breakdownBySource.get(row.source) ?? [];
    rows.push(row);
    breakdownBySource.set(row.source, rows);
  }
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
  const playBySource = new Map<string, SourcePlayReporterSummary>();
  const playDailyBySource = new Map<string, SourcePlayReporterDaily[]>();
  for (const row of playWindow) {
    const rows = playDailyBySource.get(row.source) ?? [];
    rows.push(row);
    playDailyBySource.set(row.source, rows);
    const summary = playBySource.get(row.source) ?? {
      source: row.source,
      successReporterDays: 0,
      failureReporterDays: 0,
      lastSuccessDate: null,
    };
    summary.successReporterDays += row.successReporterDays;
    summary.failureReporterDays += row.failureReporterDays;
    playBySource.set(row.source, summary);
  }
  return config.SourceConfig.map((source) =>
    scoreSourceHealth(
      source.key,
      searchBySource.get(source.key) ?? [],
      playBySource.get(source.key),
      lastOkBySource.get(source.key) ?? null,
      buildSourceHealthDaily(
        dates,
        searchBySource.get(source.key) ?? [],
        playDailyBySource.get(source.key) ?? [],
        smoothBySource.get(source.key) ?? [],
      ),
      smoothBySource.get(source.key) ?? [],
      breakdownBySource.get(source.key) ?? [],
    ),
  );
}

let reportCache: {
  report: SourceHealthReportItem[] | null;
  expiresAt: number;
} | null = null;
let reportInFlight: Promise<SourceHealthReportItem[] | null> | null = null;

// null 缓存读取失败：排序降级，用户接口仍可区分失败与空报告。
export async function getCachedSourceHealthReport(): Promise<
  SourceHealthReportItem[] | null
> {
  if (reportCache && reportCache.expiresAt > Date.now()) {
    return cloneReport(reportCache.report);
  }
  if (!reportInFlight) {
    reportInFlight = getSourceHealthReport(SOURCE_HEALTH_DEFAULT_DAYS)
      .catch((error) => {
        console.warn('Failed to load source health report', error);
        return null;
      })
      .then((report) => {
        reportCache = {
          report,
          expiresAt: Date.now() + SOURCE_HEALTH_TIERS_CACHE_TTL_MS,
        };
        return report;
      })
      .finally(() => {
        reportInFlight = null;
      });
  }
  return cloneReport(await reportInFlight);
}

function cloneReport(report: SourceHealthReportItem[] | null) {
  return (
    report?.map((item) => ({
      ...item,
      daily: item.daily.map((point) => ({ ...point })),
      smoothBreakdown: item.smoothBreakdown.map((row) => ({ ...row })),
    })) ?? null
  );
}

export async function getSourceHealthTiers(): Promise<
  Map<string, SourceHealthTier>
> {
  const report = await getCachedSourceHealthReport();
  return new Map(report?.map((item) => [item.source, item.tier]));
}

export async function cleanupSourceHealth(): Promise<void> {
  await db.purgeSourceHealthBefore(
    utcDateDaysAgo(SOURCE_HEALTH_RETENTION_DAYS, new Date()),
  );
}
