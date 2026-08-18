import type { SearchResult } from '@/lib/types';

import type { VideoCardProps } from './types';

function isSameStringArray(prev?: string[], next?: string[]): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return !prev && !next;
  }
  if (prev.length !== next.length) {
    return false;
  }

  return prev.every((item, index) => item === next[index]);
}

function isSameAggregateGroup(
  prev?: SearchResult[],
  next?: SearchResult[],
): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return !prev && !next;
  }
  if (prev.length !== next.length) {
    return false;
  }

  return prev.every((item, index) => {
    const nextItem = next[index];
    return (
      item.id === nextItem.id &&
      item.source === nextItem.source &&
      item.title === nextItem.title &&
      item.poster === nextItem.poster &&
      item.year === nextItem.year &&
      item.source_name === nextItem.source_name &&
      item.douban_id === nextItem.douban_id &&
      item.episodes.length === nextItem.episodes.length &&
      item.episodes_titles.length === nextItem.episodes_titles.length
    );
  });
}

export function areVideoCardPropsEqual(
  prev: Readonly<VideoCardProps>,
  next: Readonly<VideoCardProps>,
): boolean {
  return (
    prev.id === next.id &&
    prev.source === next.source &&
    prev.title === next.title &&
    prev.query === next.query &&
    prev.poster === next.poster &&
    prev.priority === next.priority &&
    prev.episodes === next.episodes &&
    prev.source_name === next.source_name &&
    isSameStringArray(prev.source_names, next.source_names) &&
    prev.progress === next.progress &&
    prev.resumeTime === next.resumeTime &&
    prev.year === next.year &&
    prev.from === next.from &&
    prev.currentEpisode === next.currentEpisode &&
    prev.resumeEpisodeIndex === next.resumeEpisodeIndex &&
    prev.douban_id === next.douban_id &&
    prev.rate === next.rate &&
    prev.type === next.type &&
    prev.isBangumi === next.isBangumi &&
    prev.isAggregate === next.isAggregate &&
    prev.origin === next.origin &&
    isSameAggregateGroup(prev.aggregateGroup, next.aggregateGroup)
  );
}
