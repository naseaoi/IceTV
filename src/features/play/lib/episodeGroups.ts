import { resolveEpisodeGroupPosition } from '@/lib/episode-groups';
import { parseLazyEpisodeUrl } from '@/lib/lazy-episodes';
import type { SearchResult } from '@/lib/types';

export type { EpisodeGroupPosition } from '@/lib/episode-groups';
export { resolveEpisodeGroupPosition } from '@/lib/episode-groups';

function isGiriDetail(detail: SearchResult): boolean {
  const firstEpisode = detail.episodes?.[0];
  if (!firstEpisode) {
    return false;
  }
  return parseLazyEpisodeUrl(firstEpisode)?.kind === 'giri';
}

/**
 * 仅在 giri 源站不同分组之间切换同一集（组内偏移相同）时继承播放时间点。
 */
export function shouldInheritCrossGroupProgress(
  detail: SearchResult | null,
  fromEpisodeIndex: number,
  toEpisodeIndex: number,
): boolean {
  if (!detail || !isGiriDetail(detail)) {
    return false;
  }

  const totalEpisodes = detail.episodes?.length || 0;
  const from = resolveEpisodeGroupPosition(
    detail.episode_groups,
    fromEpisodeIndex,
    totalEpisodes,
  );
  const to = resolveEpisodeGroupPosition(
    detail.episode_groups,
    toEpisodeIndex,
    totalEpisodes,
  );

  return (
    !!from &&
    !!to &&
    from.groupIndex !== to.groupIndex &&
    from.episodeOffset === to.episodeOffset
  );
}
