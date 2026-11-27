import {
  type SourceHealthReportItem,
  type SourceHealthTier,
  hasSourceSmoothDimension,
  SOURCE_HEALTH_DAILY_OK_RATE,
  SOURCE_HEALTH_TIER_PRIORITY,
  SOURCE_SMOOTH_MAX_STALL_RATIO,
} from '@/lib/source-quality-policy';
import type { SourceSmoothMediaType } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// 代理出口判定：两条线路都要有足够观察时长，且代理卡顿率显著高于直连
const PROXY_STUTTER_MIN_WATCH_MS = 10 * HOUR_MS;
const PROXY_STUTTER_MIN_RATIO_FACTOR = 2;

const ROUTE_LABEL = { browser: '直连', server: '代理' } as const;
const MEDIA_LABEL: Record<SourceSmoothMediaType, string> = {
  hls: 'HLS',
  mp4: 'MP4',
};

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
      ? `播放可用（含测速） ${formatPercent(item.playSuccessRate)} · ${item.playReporterDays} 上报者日`
      : '播放可用（含测速） 无样本',
  );
  lines.push(...describeSmoothness(item));
  lines.push(`最近可用 ${formatLastOkDate(item.lastOkDate, now)}`);
  return lines.join('\n');
}

/** 流畅维度已计分且流畅日占比不足优质线，行内标出，提示质量分受卡顿拖累。 */
export function isSourceStuttering(
  item: SourceHealthReportItem | null | undefined,
): boolean {
  return (
    !!item &&
    hasSourceSmoothDimension(item) &&
    item.smoothRate !== null &&
    item.smoothRate < SOURCE_HEALTH_DAILY_OK_RATE
  );
}

function formatHours(ms: number): string {
  const hours = ms / HOUR_MS;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} 小时`;
}

function formatStallRatio(stallMs: number, watchMs: number): string {
  const total = stallMs + watchMs;
  return total > 0 ? `${((stallMs / total) * 100).toFixed(1)}%` : '—';
}

function formatStallsPer10Min(
  stallCount: number,
  watchMs: number,
  stallMs: number,
): string {
  const total = stallMs + watchMs;
  return total > 0 ? ((stallCount * 600_000) / total).toFixed(1) : '—';
}

function describeSmoothness(item: SourceHealthReportItem): string[] {
  if (item.smoothReporterDays === 0 || item.smoothRate === null) {
    return ['播放流畅 无样本'];
  }
  const lines = [
    `播放流畅 ${formatPercent(item.smoothRate)} · ${item.smoothReporterDays} 上报者日 · ${item.smoothAccounts} 人${
      hasSourceSmoothDimension(item) ? '' : '（样本不足，未计分）'
    }`,
  ];
  if (item.stallRatio !== null && item.stallsPer10Min !== null) {
    lines.push(
      `卡顿率 ${(item.stallRatio * 100).toFixed(1)}% · 每 10 分钟 ${item.stallsPer10Min.toFixed(1)} 次 · 观察 ${formatHours(item.smoothWatchMs)}`,
    );
  }
  for (const layer of item.smoothBreakdown) {
    if (layer.watchMs <= 0) continue;
    const unknown =
      layer.unknownMs >= 60_000
        ? ` · 未归因等待 ${Math.round(layer.unknownMs / 60_000)} 分钟`
        : '';
    lines.push(
      `  ${ROUTE_LABEL[layer.routeMode]} ${MEDIA_LABEL[layer.mediaType]} 卡顿率 ${formatStallRatio(layer.stallMs, layer.watchMs)} · 每 10 分钟 ${formatStallsPer10Min(layer.stallCount, layer.watchMs, layer.stallMs)} 次 · ${formatHours(layer.watchMs)}${unknown}`,
    );
  }
  return lines;
}

/**
 * 代理线路整体卡顿率明显高于直连时，瓶颈更可能在本站出口而非各源站。
 * 返回提示文案，条件不满足时返回 null。
 */
export function getProxyStutterNotice(
  items: Iterable<SourceHealthReportItem>,
): string | null {
  const totals = {
    browser: { watchMs: 0, stallMs: 0 },
    server: { watchMs: 0, stallMs: 0 },
  };
  for (const item of items) {
    for (const layer of item.smoothBreakdown) {
      totals[layer.routeMode].watchMs += layer.watchMs;
      totals[layer.routeMode].stallMs += layer.stallMs;
    }
  }
  const { browser, server } = totals;
  if (
    browser.watchMs < PROXY_STUTTER_MIN_WATCH_MS ||
    server.watchMs < PROXY_STUTTER_MIN_WATCH_MS
  ) {
    return null;
  }
  const ratio = (route: { watchMs: number; stallMs: number }) =>
    route.stallMs / (route.watchMs + route.stallMs);
  const serverRatio = ratio(server);
  const browserRatio = ratio(browser);
  if (
    serverRatio <= SOURCE_SMOOTH_MAX_STALL_RATIO ||
    serverRatio < browserRatio * PROXY_STUTTER_MIN_RATIO_FACTOR
  ) {
    return null;
  }
  return `代理线路整体卡顿率 ${(serverRatio * 100).toFixed(1)}%，直连 ${(browserRatio * 100).toFixed(1)}%，优先排查本站出口带宽`;
}
