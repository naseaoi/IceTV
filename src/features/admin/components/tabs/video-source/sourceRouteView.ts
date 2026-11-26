import type { SourceProxyMode } from '@/lib/proxy-modes';
import type {
  SourceProxyFailureItem,
  SourceProxyFailureReason,
  SourceRouteStatsItem,
} from '@/lib/types';

export type RouteModeStats = {
  successCount: number;
  failureCount: number;
  totalCount: number;
  successRate: number | null;
};

export type ProxyFailureShare = {
  reason: SourceProxyFailureReason;
  count: number;
  share: number;
};

export type SourceRouteStatsView = {
  /** 首选直连 */
  browser?: RouteModeStats;
  /** 首选代理（固定代理或自动模式命中代理成功记忆） */
  server?: RouteModeStats;
  /** 代理失败后回落直连 */
  browserFallback?: RouteModeStats;
  /** 直连失败后回落代理，成功率即代理挽回率 */
  serverFallback?: RouteModeStats;
  /** 服务端记录的代理失败原因，按次数降序 */
  proxyFailures?: ProxyFailureShare[];
  proxyFailureTotal?: number;
};

export type SourceRouteAdvice =
  | {
      kind: 'mode';
      target: SourceProxyMode;
      label: string;
      detail: string;
    }
  | { kind: 'dead'; label: string; detail: string };

/** 样本少于此数不下结论，避免个别用户网络把整源判成坏线路 */
export const ROUTE_ADVICE_MIN_SAMPLES = 20;

export const PROXY_FAILURE_REASON_LABEL: Record<
  SourceProxyFailureReason,
  string
> = {
  'http-403': '上游拒绝 403',
  'http-404': '上游 404',
  'http-4xx': '上游其他 4xx',
  'http-5xx': '上游 5xx',
  timeout: '超时',
  connection: '连接中断',
  'invalid-response': '响应异常',
};

function toRouteModeStats(
  successCount: number,
  failureCount: number,
): RouteModeStats {
  const totalCount = successCount + failureCount;
  return {
    successCount,
    failureCount,
    totalCount,
    successRate: totalCount > 0 ? successCount / totalCount : null,
  };
}

export function buildSourceRouteViews(
  items: readonly SourceRouteStatsItem[],
  failures: readonly SourceProxyFailureItem[],
): Record<string, SourceRouteStatsView> {
  const views: Record<string, SourceRouteStatsView> = {};
  for (const item of items) {
    const view = (views[item.source] ??= {});
    const key =
      item.phase === 'fallback'
        ? item.routeMode === 'server'
          ? 'serverFallback'
          : 'browserFallback'
        : item.routeMode;
    view[key] = toRouteModeStats(item.successCount, item.failureCount);
  }
  const counts = new Map<string, Map<SourceProxyFailureReason, number>>();
  for (const item of failures) {
    if (item.failureCount <= 0) continue;
    const bySource = counts.get(item.source) ?? new Map();
    bySource.set(
      item.reason,
      (bySource.get(item.reason) ?? 0) + item.failureCount,
    );
    counts.set(item.source, bySource);
  }
  for (const [source, bySource] of counts) {
    const total = [...bySource.values()].reduce((sum, n) => sum + n, 0);
    const view = (views[source] ??= {});
    view.proxyFailureTotal = total;
    view.proxyFailures = [...bySource]
      .map(([reason, count]) => ({ reason, count, share: count / total }))
      .sort((a, b) => b.count - a.count);
  }
  return views;
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

function ratio(stats?: RouteModeStats): string {
  return stats && stats.successRate !== null
    ? `${percent(stats.successRate)}（${stats.successCount}/${stats.totalCount}）`
    : '无样本';
}

function enough(stats?: RouteModeStats): stats is RouteModeStats & {
  successRate: number;
} {
  return Boolean(stats && stats.totalCount >= ROUTE_ADVICE_MIN_SAMPLES);
}

function dominantFailure(view: SourceRouteStatsView): ProxyFailureShare | null {
  const top = view.proxyFailures?.[0];
  if (!top || (view.proxyFailureTotal ?? 0) < ROUTE_ADVICE_MIN_SAMPLES)
    return null;
  return top.share >= 0.5 ? top : null;
}

function failureClause(view: SourceRouteStatsView): string {
  const top = dominantFailure(view);
  return top
    ? `，代理失败 ${percent(top.share)} 为${PROXY_FAILURE_REASON_LABEL[top.reason]}`
    : '';
}

export function getSourceRouteAdvice(
  mode: SourceProxyMode,
  view: SourceRouteStatsView | null,
): SourceRouteAdvice | null {
  if (!view) return null;
  const { browser, server, serverFallback } = view;
  const top = dominantFailure(view);

  // 两条线路都失败且服务端多见 404：换线路无济于事，先提示源本身
  if (
    top?.reason === 'http-404' &&
    (!enough(browser) || browser.successRate < 0.3)
  ) {
    return {
      kind: 'dead',
      label: '疑似失效',
      detail: `代理失败 ${percent(top.share)} 为上游 404，直连成功率 ${ratio(browser)}，资源地址可能已失效`,
    };
  }

  if (mode === 'auto' && enough(serverFallback)) {
    if (serverFallback.successRate < 0.1) {
      return {
        kind: 'mode',
        target: 'browser',
        label: '建议直连',
        detail: `直连失败后代理只挽回 ${ratio(serverFallback)}${failureClause(view)}；回落代理只增加等待与中转流量`,
      };
    }
    if (
      enough(browser) &&
      browser.successRate < 0.2 &&
      serverFallback.successRate >= 0.8
    ) {
      return {
        kind: 'mode',
        target: 'server',
        label: '建议代理',
        detail: `直连成功率 ${ratio(browser)}，失败后代理挽回 ${ratio(serverFallback)}；改为代理可省去直连等待，但会增加服务器流量`,
      };
    }
  }

  if (mode === 'server' && enough(server) && server.successRate < 0.2) {
    return {
      kind: 'mode',
      target: 'auto',
      label: '建议自动',
      detail: `代理成功率 ${ratio(server)}${failureClause(view)}；改为自动可让浏览器先直连`,
    };
  }

  return null;
}

function rate(stats?: RouteModeStats): string {
  return stats && stats.successRate !== null ? percent(stats.successRate) : '—';
}

export function formatRouteSummary(view: SourceRouteStatsView | null): string {
  const parts = [`直连 ${rate(view?.browser)}`, `代理 ${rate(view?.server)}`];
  if (view?.serverFallback) parts.push(`挽回 ${rate(view.serverFallback)}`);
  return parts.join(' · ');
}

export function formatRouteDetails(
  view: SourceRouteStatsView | null,
  days: number,
): string {
  const count = (stats?: RouteModeStats) =>
    stats ? `${stats.successCount}/${stats.totalCount}` : '—';
  const lines = [
    `${days}天成功数/样本数（含换源测速）`,
    `首选直连 ${count(view?.browser)} · 首选代理 ${count(view?.server)}`,
    `直连失败后代理挽回 ${count(view?.serverFallback)}`,
  ];
  if (view?.browserFallback)
    lines.push(`代理失败后直连挽回 ${count(view.browserFallback)}`);
  if (view?.proxyFailures?.length) {
    lines.push(
      `代理失败原因：${view.proxyFailures
        .slice(0, 3)
        .map(
          (item) =>
            `${PROXY_FAILURE_REASON_LABEL[item.reason]} ${percent(item.share)}`,
        )
        .join('、')}`,
    );
  }
  return lines.join('\n');
}
