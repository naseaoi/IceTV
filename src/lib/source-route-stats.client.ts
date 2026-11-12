'use client';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type { SourceRouteMode } from '@/lib/types';

type SourceOutcomePayload = {
  source: string;
  success: boolean;
  eventAt: number;
};
type SourceRouteStatPayload = SourceOutcomePayload & {
  routeMode: SourceRouteMode;
};
type PendingReport = {
  username: string;
  stat?: SourceRouteStatPayload;
  outcome?: SourceOutcomePayload;
};

let pending: PendingReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function flushReports(): void {
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
  kind: 'stat' | 'outcome',
  payload: SourceRouteStatPayload | SourceOutcomePayload,
): void {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username || !payload.source) return;
  // 只配对同账号同源的异类事件；同类样本全部保留，不推导源级成败。
  const match = pending.find(
    (report) =>
      report.username === username &&
      !report[kind] &&
      (report.stat ?? report.outcome)?.source === payload.source,
  );
  const report = match ?? { username };
  if (kind === 'stat') report.stat = payload as SourceRouteStatPayload;
  else report.outcome = payload;
  if (!match) pending.push(report);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushReports);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushReports();
    });
    listening = true;
  }
  if (flushTimer === undefined) flushTimer = setTimeout(flushReports, 0);
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

export function reportSourceRouteStat(
  source: string,
  routeMode: SourceRouteMode,
  success: boolean,
): void {
  enqueueReport('stat', {
    source: source.trim(),
    routeMode,
    success,
    eventAt: Date.now(),
  });
}
