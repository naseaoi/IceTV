'use client';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type { SourceRouteMode } from '@/lib/types';

type SourceRouteStatPayload = {
  source: string;
  routeMode: SourceRouteMode;
  success: boolean;
  eventAt: number;
};

export function reportSourcePlayOutcome(
  source: string,
  success: boolean,
): void {
  if (!getAuthInfoFromBrowserCookie()?.username || !source.trim()) return;
  try {
    void fetch('/api/source-route-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outcome: { source: source.trim(), success, eventAt: Date.now() },
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function reportSourceRouteStat(
  source: string,
  routeMode: SourceRouteMode,
  success: boolean,
): void {
  if (!getAuthInfoFromBrowserCookie()?.username) return;

  const cleanSource = source.trim();
  if (!cleanSource) return;

  const payload: { stat: SourceRouteStatPayload } = {
    stat: {
      source: cleanSource,
      routeMode,
      success,
      eventAt: Date.now(),
    },
  };

  try {
    void fetch('/api/source-route-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
