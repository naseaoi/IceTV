'use client';

import type { SourceRouteMode } from '@/lib/types';

type SourceRouteStatPayload = {
  source: string;
  routeMode: SourceRouteMode;
  success: boolean;
  eventAt: number;
};

export function reportSourceRouteStat(
  source: string,
  routeMode: SourceRouteMode,
  success: boolean,
): void {
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
