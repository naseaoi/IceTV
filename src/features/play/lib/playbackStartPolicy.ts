import { resolveEpisodeGroupPosition } from '@/features/play/lib/episodeGroups';
import {
  hasUsableDuration,
  isFinishedResumeTarget,
} from '@/features/play/lib/resumePlayback';
import type { SearchResult } from '@/lib/types';

export const START_DETAIL_WAIT_MS = 5000;

export interface PlaybackStartTarget {
  episodeIndex: number;
  resumeTime: number;
  recordDuration?: number;
  knownEpisodeCount?: number;
}

export type PlaybackStartDecision =
  | {
      kind: 'play';
      episodeIndex: number;
      resumeTime: number;
      needsDuration: boolean;
    }
  | { kind: 'park'; episodeIndex: number; resumeTime: number }
  | { kind: 'wait' };

export function getNextPlaybackEpisode(
  detail: SearchResult,
  index: number,
): number | null {
  const group = resolveEpisodeGroupPosition(
    detail.episode_groups,
    index,
    detail.episodes.length,
  );
  return index + 1 < detail.episodes.length &&
    (!group || group.episodeOffset + 1 < group.groupCount)
    ? index + 1
    : null;
}

/** 仅供首次起播恢复使用；换源、重试与主动切集沿用各自的位置策略。 */
export function decidePlaybackStart({
  target,
  detail,
  autoPlayNext,
  refreshing = false,
  waitExpired = false,
  actualDuration,
  nextResumeTime = 0,
}: {
  target: PlaybackStartTarget;
  detail: SearchResult;
  autoPlayNext: boolean;
  refreshing?: boolean;
  waitExpired?: boolean;
  actualDuration?: number;
  nextResumeTime?: number;
}): PlaybackStartDecision {
  const duration = hasUsableDuration(target.recordDuration)
    ? target.recordDuration
    : actualDuration;
  if (!isFinishedResumeTarget(target.resumeTime, duration)) {
    return {
      kind: 'play',
      episodeIndex: target.episodeIndex,
      resumeTime: target.resumeTime,
      needsDuration: target.resumeTime > 0 && !hasUsableDuration(duration),
    };
  }
  const next = getNextPlaybackEpisode(detail, target.episodeIndex);
  if (autoPlayNext && next !== null) {
    return {
      kind: 'play',
      episodeIndex: next,
      resumeTime: nextResumeTime,
      needsDuration: false,
    };
  }
  // 当前详情没有下一集、但记录已知集数更多：本地详情过期，连播开启时等刷新再决定
  const group = resolveEpisodeGroupPosition(
    detail.episode_groups,
    target.episodeIndex,
    detail.episodes.length,
  );
  const stale =
    (target.knownEpisodeCount ?? 0) >
    (group?.groupCount ?? detail.episodes.length);
  if (autoPlayNext && stale && refreshing && !waitExpired) {
    return { kind: 'wait' };
  }
  return {
    kind: 'park',
    episodeIndex: target.episodeIndex,
    resumeTime: target.resumeTime,
  };
}
