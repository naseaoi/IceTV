'use client';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type {
  SourceRouteMode,
  SourceRouteStatPhase,
  SourceSmoothnessPayload,
} from '@/lib/types';

type SourceOutcomePayload = {
  source: string;
  success: boolean;
  eventAt: number;
};
type SourceRouteStatPayload = SourceOutcomePayload & {
  routeMode: SourceRouteMode;
  phase: SourceRouteStatPhase;
};
type PendingReport = {
  username: string;
  stat?: SourceRouteStatPayload;
  outcome?: SourceOutcomePayload;
  smooth?: SourceSmoothnessPayload;
};

let pending: PendingReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
// 换源面板一次测速约 20 个源，同一网络条件下的重复样本只放大少数重度用户的权重
const ROUTE_STAT_DEDUPE_MS = 10 * 60 * 1000;
const recentRouteStats = new Map<string, number>();

export function flushSourceRouteReports(): void {
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
  const reports = pending;
  pending = [];
  const username = getAuthInfoFromBrowserCookie()?.username;
  for (const { username: account, ...payload } of reports) {
    if (account !== username) continue;
    try {
      void fetch('/api/source-route-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }
}

function enqueueReport(
  kind: 'stat' | 'outcome' | 'smooth',
  payload:
    | SourceRouteStatPayload
    | SourceOutcomePayload
    | SourceSmoothnessPayload,
  dedupeKey?: string,
): void {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username || !payload.source) return;
  if (dedupeKey) {
    const key = `${username}|${dedupeKey}`;
    const now = Date.now();
    const last = recentRouteStats.get(key);
    if (last !== undefined && now - last < ROUTE_STAT_DEDUPE_MS) return;
    for (const [staleKey, at] of recentRouteStats) {
      if (now - at >= ROUTE_STAT_DEDUPE_MS) recentRouteStats.delete(staleKey);
    }
    recentRouteStats.set(key, now);
  }
  // 只配对同账号同源的异类事件；同类样本全部保留，不推导源级成败。
  const match = pending.find(
    (report) =>
      report.username === username &&
      !report[kind] &&
      (report.stat ?? report.outcome ?? report.smooth)?.source ===
        payload.source,
  );
  const report = match ?? { username };
  if (kind === 'stat') report.stat = payload as SourceRouteStatPayload;
  else if (kind === 'smooth')
    report.smooth = payload as SourceSmoothnessPayload;
  else report.outcome = payload as SourceOutcomePayload;
  if (!match) pending.push(report);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushSourceRouteReports);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSourceRouteReports();
    });
    listening = true;
  }
  if (flushTimer === undefined)
    flushTimer = setTimeout(flushSourceRouteReports, 0);
}

export function reportSourcePlayOutcome(
  source: string,
  success: boolean,
): void {
  enqueueReport('outcome', {
    source: source.trim(),
    success,
    eventAt: Date.now(),
  });
}

/**
 * phase 区分首选线路与失败后的回落线路：自动模式下代理多为回落，
 * 混在一起会把「直连失败后代理也救不回」误读成代理本身不可用。
 */
export function reportSourceRouteStat(
  source: string,
  routeMode: SourceRouteMode,
  success: boolean,
  phase: SourceRouteStatPhase,
): void {
  const trimmed = source.trim();
  enqueueReport(
    'stat',
    { source: trimmed, routeMode, phase, success, eventAt: Date.now() },
    `${trimmed}|${routeMode}|${phase}|${success ? 1 : 0}`,
  );
}

export function reportSourceSmoothness(payload: SourceSmoothnessPayload): void {
  if (
    !payload.watchMs &&
    !payload.stallMs &&
    !payload.stallCount &&
    !payload.unknownMs
  )
    return;
  // 增量逐条保留；长时间暂停调度后仍满足单请求观看时长上限。
  const remaining = {
    watchMs: payload.watchMs,
    stallMs: payload.stallMs,
    stallCount: payload.stallCount,
    unknownMs: payload.unknownMs,
  };
  do {
    const part = {
      watchMs: Math.min(remaining.watchMs, 600_000),
      stallMs: Math.min(remaining.stallMs, 30_000),
      stallCount: Math.min(remaining.stallCount, 120),
      unknownMs: Math.min(remaining.unknownMs, 30_000),
    };
    enqueueReport('smooth', {
      ...payload,
      source: payload.source.trim(),
      ...part,
    });
    for (const key of Object.keys(part) as Array<keyof typeof part>) {
      remaining[key] -= part[key];
    }
  } while (Object.values(remaining).some((value) => value > 0));
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    flushSourceRouteReports();
  }
}

export function resetSourceRouteStatDedupeForTests(): void {
  recentRouteStats.clear();
}
