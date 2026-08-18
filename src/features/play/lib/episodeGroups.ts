import { parseLazyEpisodeUrl } from '@/lib/lazy-episodes';
import type { EpisodeGroup, SearchResult } from '@/lib/types';

export interface EpisodeGroupPosition {
  groupIndex: number;
  /** 组内 0-based 集偏移 */
  episodeOffset: number;
  /** 当前组的集数 */
  groupCount: number;
}

/**
 * 把拼接后的全局集索引换算成所在分组内的位置。
 * 分组信息无效（缺失、单组、总数对不上、索引越界）时返回 null。
 */
export function resolveEpisodeGroupPosition(
  groups: EpisodeGroup[] | undefined,
  episodeIndex: number,
  totalEpisodes: number,
): EpisodeGroupPosition | null {
  if (!groups || groups.length < 2) {
    return null;
  }

  const groupTotal = groups.reduce((sum, group) => sum + group.count, 0);
  if (groupTotal !== totalEpisodes) {
    return null;
  }

  if (
    !Number.isInteger(episodeIndex) ||
    episodeIndex < 0 ||
    episodeIndex >= totalEpisodes
  ) {
    return null;
  }

  let start = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const count = groups[groupIndex].count;
    if (episodeIndex < start + count) {
      return {
        groupIndex,
        episodeOffset: episodeIndex - start,
        groupCount: count,
      };
    }
    start += count;
  }

  return null;
}

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
