'use client';

import { useEffect, useState } from 'react';

import { adminGet } from '@/features/admin/lib/api';
import type { SourceHealthReportItem } from '@/lib/source-quality-policy';
import type { SourceRouteStatsItem } from '@/lib/types';

export const SOURCE_INSIGHT_DAYS = 7;

export interface SourceInsights {
  routeStats: SourceRouteStatsItem[];
  health: Map<string, SourceHealthReportItem>;
}

const EMPTY_INSIGHTS: SourceInsights = {
  routeStats: [],
  health: new Map(),
};

// 线路统计与源站质量两路独立读取，任一失败只清空该部分
export function useSourceInsights(
  reloadKey: unknown,
  enabled = true,
): SourceInsights {
  const [insights, setInsights] = useState<SourceInsights>(EMPTY_INSIGHTS);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const update = (patch: Partial<SourceInsights>) => {
      if (!cancelled) setInsights((prev) => ({ ...prev, ...patch }));
    };

    adminGet<{
      stats: SourceRouteStatsItem[];
    }>(
      `/api/admin/source-route-stats?days=${SOURCE_INSIGHT_DAYS}`,
      '读取路由统计失败',
    )
      .then((payload) =>
        update({
          routeStats: payload.stats || [],
        }),
      )
      .catch((error) => {
        console.warn('读取路由统计失败:', error);
        update({ routeStats: [] });
      });
    adminGet<{ items: SourceHealthReportItem[] }>(
      `/api/admin/source-health?days=${SOURCE_INSIGHT_DAYS}`,
      '读取源站质量失败',
    )
      .then((payload) =>
        update({
          health: new Map(
            (payload.items || []).map((item) => [item.source, item]),
          ),
        }),
      )
      .catch((error) => {
        console.warn('读取源站质量失败:', error);
        update({ health: new Map() });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, enabled]);

  return insights;
}
