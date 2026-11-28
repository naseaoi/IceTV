import type {
  SourceHealthSearchDaily,
  SourcePlayReporterDaily,
  SourcePlayReporterSummary,
  SourceSmoothBreakdownItem,
  SourceSmoothReporterDaily,
} from '@/lib/types';

export const SOURCE_HEALTH_DEFAULT_DAYS = 7;
export const SOURCE_HEALTH_RETENTION_DAYS = 30;
export const SOURCE_ROUTE_STATS_RETENTION_DAYS = 37;
export const SOURCE_HEALTH_FLUSH_INTERVAL_MS = 60_000;
export const SOURCE_HEALTH_MIN_SEARCH_ATTEMPTS = 10;
export const SOURCE_HEALTH_MIN_PLAY_REPORTER_DAYS = 3;
export const SOURCE_HEALTH_MIN_OFFLINE_DAYS = 2;
export const SOURCE_HEALTH_PRIOR_SUCCESS = 1;
export const SOURCE_HEALTH_PRIOR_TOTAL = 2;
export const SOURCE_HEALTH_DAILY_MIN_SEARCH_ATTEMPTS = 5;
export const SOURCE_HEALTH_DAILY_MIN_PLAY_REPORTER_DAYS = 3;
export const SOURCE_HEALTH_DAILY_OK_RATE = 0.85;
export const SOURCE_HEALTH_DAILY_DEGRADED_RATE = 0.5;
export const SOURCE_HEALTH_PUBLIC_MIN_PLAY_REPORTER_DAYS = 20;
export const SOURCE_HEALTH_POOR_SCORE = 50;
export const SOURCE_HEALTH_GOOD_SCORE = 85;
export const SOURCE_HEALTH_GOOD_LATENCY_MS = 3000;

// 播放流畅度：客户端本机偏好与服务端评分共用同一卡顿判定
export const SOURCE_SMOOTH_MIN_WATCH_MS = 5 * 60 * 1000;
export const SOURCE_SMOOTH_MAX_STALL_RATIO = 0.015;
export const SOURCE_SMOOTH_MAX_STALLS_PER_10_MIN = 2;
export const SOURCE_SMOOTH_MIN_REPORTER_DAYS = 20;
export const SOURCE_SMOOTH_MIN_ACCOUNTS = 5;
// 同一上报者同日在至少这么多个源上卡顿且无流畅源时，视为其自身网络受限
export const SOURCE_SMOOTH_NETWORK_LIMITED_SOURCES = 3;
export const SOURCE_SMOOTH_DAILY_MIN_ACCOUNTS = 3;
export const SOURCE_SMOOTH_DAILY_MIN_WATCH_MS = 30 * 60 * 1000;

export interface SourceSmoothSample {
  watchMs: number;
  stallMs: number;
  stallCount: number;
}

/** 观察时长不足返回 null；否则卡顿率或每 10 分钟卡顿次数任一超限即为卡顿。 */
export function isSmoothSampleStuttering(
  sample: SourceSmoothSample,
): boolean | null {
  if (sample.watchMs < SOURCE_SMOOTH_MIN_WATCH_MS) return null;
  const totalMs = sample.watchMs + sample.stallMs;
  return (
    sample.stallMs / totalMs > SOURCE_SMOOTH_MAX_STALL_RATIO ||
    (sample.stallCount * 600_000) / totalMs >=
      SOURCE_SMOOTH_MAX_STALLS_PER_10_MIN
  );
}

export interface EffectiveSmoothDaily extends SourceSmoothReporterDaily {
  stuttering: boolean;
}

/** 先跨源识别网络受限的上报者日，再保留可评分的源上报者日。 */
export function getEffectiveSmoothDaily(
  rows: readonly SourceSmoothReporterDaily[],
): EffectiveSmoothDaily[] {
  const classified: EffectiveSmoothDaily[] = [];
  const reporterDays = new Map<
    string,
    { stutteringSources: Set<string>; hasSmooth: boolean }
  >();
  for (const row of rows) {
    const stuttering = isSmoothSampleStuttering(row);
    if (stuttering === null) continue;
    classified.push({ ...row, stuttering });
    const key = JSON.stringify([row.bucketDate, row.reporter]);
    const day = reporterDays.get(key) ?? {
      stutteringSources: new Set<string>(),
      hasSmooth: false,
    };
    if (stuttering) day.stutteringSources.add(row.source);
    else day.hasSmooth = true;
    reporterDays.set(key, day);
  }
  return classified.filter((row) => {
    const day = reporterDays.get(
      JSON.stringify([row.bucketDate, row.reporter]),
    )!;
    return (
      day.hasSmooth ||
      day.stutteringSources.size < SOURCE_SMOOTH_NETWORK_LIMITED_SOURCES
    );
  });
}

export type SourceHealthTier =
  | 'offline'
  | 'poor'
  | 'good'
  | 'normal'
  | 'insufficient';

export type SourceHealthDailyStatus = 'ok' | 'degraded' | 'down' | 'none';

export interface SourceHealthDailyPoint {
  date: string;
  status: SourceHealthDailyStatus;
}

export type SourceHealthPublicTier = 'good' | 'normal' | 'poor' | 'offline';

export interface SourceHealthPublicItem {
  tier: SourceHealthPublicTier;
  playAvailability: number | null;
  smoothRate: number | null;
  searchAvailability: number | null;
  lastOkDate: string | null;
  daily: SourceHealthDailyPoint[];
}

export interface SourceHealthPublicResponse {
  days: number;
  items: Record<string, SourceHealthPublicItem>;
}

export interface SourceHealthReportItem {
  source: string;
  score: number | null;
  tier: SourceHealthTier;
  searchAttempts: number;
  searchAvailability: number | null;
  avgSearchLatencyMs: number | null;
  playReporterDays: number;
  playSuccessRate: number | null;
  smoothReporterDays: number;
  smoothAccounts: number;
  smoothRate: number | null;
  stallRatio: number | null;
  stallsPer10Min: number | null;
  smoothWatchMs: number;
  smoothBreakdown: SourceSmoothBreakdownItem[];
  lastOkDate: string | null;
  daily: SourceHealthDailyPoint[];
}

export function hasSourceSmoothDimension(item: {
  smoothReporterDays: number;
  smoothAccounts: number;
}): boolean {
  return (
    item.smoothReporterDays >= SOURCE_SMOOTH_MIN_REPORTER_DAYS &&
    item.smoothAccounts >= SOURCE_SMOOTH_MIN_ACCOUNTS
  );
}

/** 调用方先按流畅维度样本门槛筛选，未达门槛传 null。 */
export function isSmoothRateStuttering(smoothRate: number | null): boolean {
  return smoothRate !== null && smoothRate < SOURCE_HEALTH_DAILY_OK_RATE;
}

export function toPublicSourceHealth(
  item: SourceHealthReportItem,
): SourceHealthPublicItem | null {
  const hasPublicPlay =
    item.playReporterDays >= SOURCE_HEALTH_PUBLIC_MIN_PLAY_REPORTER_DAYS;
  if (
    item.tier === 'insufficient' ||
    (item.tier !== 'offline' && !hasPublicPlay)
  ) {
    return null;
  }
  return {
    tier: item.tier,
    playAvailability: hasPublicPlay ? item.playSuccessRate : null,
    smoothRate: hasSourceSmoothDimension(item) ? item.smoothRate : null,
    searchAvailability: item.searchAvailability,
    lastOkDate: item.lastOkDate,
    daily: item.daily.map((point) => ({ ...point })),
  };
}

export function buildSourceHealthDaily(
  dates: readonly string[],
  searchRows: readonly SourceHealthSearchDaily[],
  playRows: readonly SourcePlayReporterDaily[],
  smoothRows: readonly EffectiveSmoothDaily[] = [],
): SourceHealthDailyPoint[] {
  const smoothByDate = new Map<string, EffectiveSmoothDaily[]>();
  for (const row of smoothRows) {
    const rows = smoothByDate.get(row.bucketDate) ?? [];
    rows.push(row);
    smoothByDate.set(row.bucketDate, rows);
  }
  const searchByDate = new Map(searchRows.map((row) => [row.bucketDate, row]));
  const playByDate = new Map(playRows.map((row) => [row.bucketDate, row]));
  return dates.map((date) => {
    const search = searchByDate.get(date);
    const play = playByDate.get(date);
    const rates: number[] = [];
    if (search) {
      const successes = search.okCount + search.emptyCount;
      const attempts = successes + search.errorCount;
      if (attempts >= SOURCE_HEALTH_DAILY_MIN_SEARCH_ATTEMPTS) {
        rates.push(successes / attempts);
      }
    }
    if (play) {
      const total = play.successReporterDays + play.failureReporterDays;
      if (total >= SOURCE_HEALTH_DAILY_MIN_PLAY_REPORTER_DAYS) {
        rates.push(play.successReporterDays / total);
      }
    }
    const rate = Math.min(...rates);
    const status: SourceHealthDailyStatus =
      rates.length === 0
        ? 'none'
        : rate >= SOURCE_HEALTH_DAILY_OK_RATE
          ? 'ok'
          : rate >= SOURCE_HEALTH_DAILY_DEGRADED_RATE
            ? 'degraded'
            : 'down';
    const smooth = smoothByDate.get(date) ?? [];
    const degradedBySmooth =
      status === 'ok' &&
      new Set(smooth.map((row) => row.reporter)).size >=
        SOURCE_SMOOTH_DAILY_MIN_ACCOUNTS &&
      smooth.reduce((sum, row) => sum + row.watchMs, 0) >=
        SOURCE_SMOOTH_DAILY_MIN_WATCH_MS &&
      smooth.filter((row) => !row.stuttering).length / smooth.length <
        SOURCE_HEALTH_DAILY_OK_RATE;
    return { date, status: degradedBySmooth ? 'degraded' : status };
  });
}

function rawRate(success: number, total: number): number | null {
  return total > 0 ? success / total : null;
}

function smoothedRate(success: number, total: number): number | null {
  return total > 0
    ? (success + SOURCE_HEALTH_PRIOR_SUCCESS) /
        (total + SOURCE_HEALTH_PRIOR_TOTAL)
    : null;
}

export function scoreSourceHealth(
  source: string,
  searchRows: readonly SourceHealthSearchDaily[],
  play: SourcePlayReporterSummary | undefined,
  lastOkDate: string | null,
  daily: SourceHealthDailyPoint[] = [],
  smoothRows: readonly EffectiveSmoothDaily[] = [],
  smoothBreakdown: SourceSmoothBreakdownItem[] = [],
): SourceHealthReportItem {
  let searchSuccesses = 0;
  let searchAttempts = 0;
  let latencyMsSum = 0;
  let latencySamples = 0;
  const searchDays = new Set<string>();
  for (const row of searchRows) {
    if (row.okCount + row.emptyCount + row.errorCount > 0) {
      searchDays.add(row.bucketDate);
    }
    searchSuccesses += row.okCount + row.emptyCount;
    searchAttempts += row.okCount + row.emptyCount + row.errorCount;
    latencyMsSum += row.latencyMsSum;
    latencySamples += row.latencySamples;
  }
  const playSuccesses = play?.successReporterDays ?? 0;
  const playReporterDays = playSuccesses + (play?.failureReporterDays ?? 0);
  const smoothedSearch = smoothedRate(searchSuccesses, searchAttempts);
  const smoothedPlay = smoothedRate(playSuccesses, playReporterDays);
  const avgSearchLatencyMs =
    latencySamples > 0 ? latencyMsSum / latencySamples : null;
  const hasSearch = searchAttempts >= SOURCE_HEALTH_MIN_SEARCH_ATTEMPTS;
  const hasPlay = playReporterDays >= SOURCE_HEALTH_MIN_PLAY_REPORTER_DAYS;
  const smoothReporterDays = smoothRows.length;
  const smoothAccounts = new Set(smoothRows.map((row) => row.reporter)).size;
  const smoothSuccesses = smoothRows.filter((row) => !row.stuttering).length;
  const smoothWatchMs = smoothRows.reduce((sum, row) => sum + row.watchMs, 0);
  const stallMs = smoothRows.reduce((sum, row) => sum + row.stallMs, 0);
  const stallCount = smoothRows.reduce((sum, row) => sum + row.stallCount, 0);
  const hasSmooth = hasSourceSmoothDimension({
    smoothReporterDays,
    smoothAccounts,
  });
  const rates: number[] = [];
  if (hasSearch) rates.push(smoothedSearch ?? 0);
  if (hasPlay) rates.push(smoothedPlay ?? 0);
  if (hasSmooth)
    rates.push(smoothedRate(smoothSuccesses, smoothReporterDays) ?? 0);
  const score = rates.length ? Math.round(Math.min(...rates) * 100) : null;

  let tier: SourceHealthTier = 'insufficient';
  if (score !== null) {
    if (
      hasSearch &&
      searchSuccesses === 0 &&
      playSuccesses === 0 &&
      searchDays.size >= SOURCE_HEALTH_MIN_OFFLINE_DAYS
    ) {
      tier = 'offline';
    } else if (score < SOURCE_HEALTH_POOR_SCORE) {
      tier = 'poor';
    } else if (
      score >= SOURCE_HEALTH_GOOD_SCORE &&
      (avgSearchLatencyMs === null ||
        avgSearchLatencyMs <= SOURCE_HEALTH_GOOD_LATENCY_MS)
    ) {
      tier = 'good';
    } else {
      tier = 'normal';
    }
  }
  return {
    source,
    score,
    tier,
    searchAttempts,
    searchAvailability: rawRate(searchSuccesses, searchAttempts),
    avgSearchLatencyMs,
    playReporterDays,
    playSuccessRate: rawRate(playSuccesses, playReporterDays),
    smoothReporterDays,
    smoothAccounts,
    smoothRate: rawRate(smoothSuccesses, smoothReporterDays),
    stallRatio: rawRate(stallMs, smoothWatchMs + stallMs),
    stallsPer10Min: rawRate(stallCount * 600_000, smoothWatchMs + stallMs),
    smoothWatchMs,
    smoothBreakdown,
    lastOkDate,
    daily,
  };
}

export function normalizeSourceHealthDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (value === null || value === '' || !Number.isFinite(parsed)) {
    return SOURCE_HEALTH_DEFAULT_DAYS;
  }
  return Math.min(
    Math.max(Math.trunc(parsed), 1),
    SOURCE_HEALTH_RETENTION_DAYS,
  );
}

export const SOURCE_HEALTH_PROBE_KEYWORDS = [
  '爱情',
  '冒险',
  '喜剧',
  '悬疑',
  '科幻',
  '动画',
  '动作',
] as const;
export const SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN = 2;
export const SOURCE_HEALTH_PROBE_CONCURRENCY = 2;

export const SOURCE_HEALTH_OFFLINE_SEARCH_TIMEOUT_MS = 5000;
export const SOURCE_HEALTH_TIERS_CACHE_TTL_MS = 5 * 60 * 1000;

export const SOURCE_HEALTH_TIER_PRIORITY: Record<SourceHealthTier, number> = {
  good: 0,
  normal: 1,
  insufficient: 2,
  poor: 3,
  offline: 4,
};

export function rankSourcesByHealth<T extends { key: string }>(
  sites: T[],
  tiers: Map<string, SourceHealthTier>,
): T[] {
  return sites
    .slice()
    .sort(
      (a, b) =>
        SOURCE_HEALTH_TIER_PRIORITY[tiers.get(a.key) ?? 'insufficient'] -
        SOURCE_HEALTH_TIER_PRIORITY[tiers.get(b.key) ?? 'insufficient'],
    );
}
