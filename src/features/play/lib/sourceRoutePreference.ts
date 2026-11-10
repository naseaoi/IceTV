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
  watchSeconds?: Readonly<Record<string, number>>;
}

export const EMPTY_SOURCE_SELECTION_CONTEXT: SourceSelectionContext = {
  proxyModes: {},
  healthTiers: {},
};

// 本地可靠性独立于远端上下文；只有双方均为中性档时才参考全局健康。
export function compareSourceRoutePreference(
  a: { source: string },
  b: { source: string },
  context: SourceSelectionContext,
  playbackStats: ReadonlyMap<string, SourcePlaybackStat>,
  now = Date.now(),
): number {
  const aTier = getSourcePlaybackPreferenceTier(
    playbackStats.get(a.source),
    now,
  );
  const bTier = getSourcePlaybackPreferenceTier(
    playbackStats.get(b.source),
    now,
  );
  if (aTier !== bTier) return aTier - bTier;

  if (aTier === 1) {
    // 没有本地证据且远端上下文不完整时，保留调用方原有顺序。
    if (
      Object.keys(context.proxyModes).length === 0 ||
      Object.keys(context.healthTiers).length === 0
    )
      return 0;
    const healthRank = (source: string) =>
      SOURCE_HEALTH_TIER_PRIORITY[
        context.healthTiers[source] ?? 'insufficient'
      ];
    const healthDifference = healthRank(a.source) - healthRank(b.source);
    if (healthDifference) return healthDifference;
  }

  const routeDifference =
    Number(context.proxyModes[a.source] === 'server') -
    Number(context.proxyModes[b.source] === 'server');
  if (routeDifference) return routeDifference;
  return aTier === 1
    ? (context.watchSeconds?.[b.source] ?? 0) -
        (context.watchSeconds?.[a.source] ?? 0)
    : 0;
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
