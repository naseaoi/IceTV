import {
  type SourcePlaybackStat,
  getSourcePlaybackPreferenceTier,
} from '@/lib/source-playback-stats';
import {
  type SourceHealthTier,
  SOURCE_HEALTH_TIER_PRIORITY,
} from '@/lib/source-quality-policy';

export interface SourceSelectionContext {
  proxyModes: Readonly<Record<string, string>>;
  healthTiers: Readonly<Record<string, SourceHealthTier>>;
}

export const EMPTY_SOURCE_SELECTION_CONTEXT: SourceSelectionContext = {
  proxyModes: {},
  healthTiers: {},
};

// 等级缺失时不猜测服务端排序的分组边界，保留调用方原有的排序。
export function compareSourceRoutePreference(
  a: { source: string },
  b: { source: string },
  context: SourceSelectionContext,
  playbackStats: ReadonlyMap<string, SourcePlaybackStat>,
  now = Date.now(),
): number {
  if (
    Object.keys(context.proxyModes).length === 0 ||
    Object.keys(context.healthTiers).length === 0
  )
    return 0;
  const healthRank = (source: string) =>
    SOURCE_HEALTH_TIER_PRIORITY[context.healthTiers[source] ?? 'insufficient'];
  return (
    healthRank(a.source) - healthRank(b.source) ||
    getSourcePlaybackPreferenceTier(playbackStats.get(a.source), now) -
      getSourcePlaybackPreferenceTier(playbackStats.get(b.source), now) ||
    Number(context.proxyModes[a.source] === 'server') -
      Number(context.proxyModes[b.source] === 'server')
  );
}

export function preferDirectRouteSources<T extends { source: string }>(
  sources: readonly T[],
  context: SourceSelectionContext,
  playbackStats: ReadonlyMap<string, SourcePlaybackStat>,
  now = Date.now(),
): T[] {
  return [...sources].sort((a, b) =>
    compareSourceRoutePreference(a, b, context, playbackStats, now),
  );
}
