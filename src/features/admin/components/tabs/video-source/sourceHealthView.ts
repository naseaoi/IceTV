import {
  type SourceHealthReportItem,
  type SourceHealthTier,
  SOURCE_HEALTH_TIER_PRIORITY,
} from '@/lib/source-quality-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SOURCE_HEALTH_TIER_LABEL: Record<SourceHealthTier, string> = {
  good: '优质',
  normal: '普通',
  poor: '低质',
  offline: '失联',
  insufficient: '样本不足',
};

export const SOURCE_HEALTH_SCORE_CLASS: Record<SourceHealthTier, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  normal: 'text-gray-700 dark:text-gray-300',
  poor: 'text-amber-600 dark:text-amber-400',
  offline: 'text-red-600 dark:text-red-400',
  insufficient: 'text-gray-400 dark:text-gray-500',
};

export const SOURCE_HEALTH_CHIP_CLASS: Partial<
  Record<SourceHealthTier, string>
> = {
  poor: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
  offline: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
};

export function sortByHealth<T extends { key: string }>(
  sources: readonly T[],
  health: ReadonlyMap<string, SourceHealthReportItem>,
): T[] {
  const rank = (source: T) => {
    const item = health.get(source.key);
    return {
      tier: SOURCE_HEALTH_TIER_PRIORITY[item?.tier ?? 'insufficient'],
      score: item?.score ?? -1,
    };
  };
  return sources
    .map((source, index) => ({ source, index, ...rank(source) }))
    .sort((a, b) => a.tier - b.tier || b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

export function isSourceCleanupCandidate(
  item: SourceHealthReportItem | null | undefined,
): boolean {
  return item?.tier === 'poor' || item?.tier === 'offline';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

export function formatLastOkDate(
  bucketDate: string | null,
  now: number = Date.now(),
): string {
  if (!bucketDate) return '30 天内无';
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  const days = Math.round((today - Date.parse(bucketDate)) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

export function describeSourceHealth(
  item: SourceHealthReportItem,
  days: number,
  now: number = Date.now(),
): string {
  const lines = [`近 ${days} 天 · ${SOURCE_HEALTH_TIER_LABEL[item.tier]}`];
  lines.push(
    item.searchAvailability !== null
      ? `搜索可用 ${formatPercent(item.searchAvailability)} · ${item.searchAttempts} 次`
      : '搜索 无样本',
  );
  if (item.avgSearchLatencyMs !== null) {
    lines.push(`平均耗时 ${formatLatency(item.avgSearchLatencyMs)}`);
  }
  lines.push(
    item.playSuccessRate !== null
      ? `播放成功 ${formatPercent(item.playSuccessRate)} · ${item.playReporterDays} 人次`
      : '播放 无样本',
  );
  lines.push(`最近可用 ${formatLastOkDate(item.lastOkDate, now)}`);
  return lines.join('\n');
}
