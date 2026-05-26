import type { SearchResult } from '@/lib/types';

import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';

interface ResolveSourceProbeEpisodeIndexOptions {
  activeDetail: SearchResult | null;
  currentEpisodeIndex: number;
  targetSource: SearchResult;
}

export function resolveSourceProbeEpisodeIndex({
  activeDetail,
  currentEpisodeIndex,
  targetSource,
}: ResolveSourceProbeEpisodeIndexOptions): number | null {
  const safeEpisodeIndex = Number.isInteger(currentEpisodeIndex)
    ? Math.max(0, currentEpisodeIndex)
    : 0;

  if (safeEpisodeIndex === 0) {
    return 0;
  }

  if (!activeDetail) {
    return safeEpisodeIndex < targetSource.episodes.length
      ? safeEpisodeIndex
      : null;
  }

  const resolvedTarget = resolveEpisodeTargetIndex(
    activeDetail,
    safeEpisodeIndex,
    targetSource,
  );

  return resolvedTarget.preserveProgress ? resolvedTarget.index : null;
}
