import type {
  SourceHealthSearchDaily,
  SourcePlayReporterDaily,
  SourcePlayReporterSummary,
} from '@/lib/types';

export const SOURCE_HEALTH_DEFAULT_DAYS = 7;
export const SOURCE_HEALTH_RETENTION_DAYS = 30;
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
  lastOkDate: string | null;
  daily: SourceHealthDailyPoint[];
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
    searchAvailability: item.searchAvailability,
    lastOkDate: item.lastOkDate,
    daily: item.daily.map((point) => ({ ...point })),
  };
}

export function buildSourceHealthDaily(
  dates: readonly string[],
  searchRows: readonly SourceHealthSearchDaily[],
  playRows: readonly SourcePlayReporterDaily[],
): SourceHealthDailyPoint[] {
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
    return { date, status };
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
  let score: number | null = null;
  if (hasSearch && hasPlay) {
    score = Math.min(smoothedSearch ?? 0, smoothedPlay ?? 0) * 100;
  } else if (hasSearch || hasPlay) {
    score = ((hasSearch ? smoothedSearch : smoothedPlay) ?? 0) * 100;
  }
  if (score !== null) score = Math.round(score);

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
