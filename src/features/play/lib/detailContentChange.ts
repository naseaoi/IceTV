import type { SearchResult } from '@/lib/types';

function getEpisodeGroupsSignature(detail: SearchResult): string {
  return (detail.episode_groups || [])
    .map((group) => `${group.label}:${group.count}`)
    .join('|');
}

export function hasDetailContentChange(
  prev: SearchResult,
  next: SearchResult,
): boolean {
  return (
    next.episodes.length !== prev.episodes.length ||
    getEpisodeGroupsSignature(next) !== getEpisodeGroupsSignature(prev) ||
    (!!next.title && next.title !== prev.title)
  );
}
