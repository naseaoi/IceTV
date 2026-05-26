import type { SearchResult } from '@/lib/types';

import type { ResumeMode } from '@/features/play/lib/resumePlayback';

export interface SourceSwitchResumeState {
  resumeTime: number;
  resumeMode: ResumeMode;
}

export interface SourceSwitchEpisodeAnchor {
  detail: SearchResult | null;
  episodeIndex: number;
}

interface ResolveSourceSwitchResumeStateOptions {
  currentPlayTime: number;
  preserveProgress: boolean;
  clearTargetEpisodeProgress: boolean;
}

interface ResolveSourceSwitchCurrentPlayTimeOptions {
  playerCurrentTime: number;
  pendingResumeTime: number | null;
  stableCurrentTime: number;
}

interface ResolveSourceSwitchEpisodeAnchorOptions {
  currentAnchor: SourceSwitchEpisodeAnchor | null;
  activeDetail: SearchResult | null;
  activeEpisodeIndex: number;
}

/**
 * 自动换源优先采用播放器里的稳定进度；
 * 若当前仅有零点几秒的探测值，则回退到待恢复的有效进度；
 * 最后回退到 stableCurrentTime（seek/timeupdate 记录的最后有效时间点）。
 */
export function resolveSourceSwitchCurrentPlayTime({
  playerCurrentTime,
  pendingResumeTime,
  stableCurrentTime,
}: ResolveSourceSwitchCurrentPlayTimeOptions): number {
  if (playerCurrentTime > 1) {
    return playerCurrentTime;
  }

  if (pendingResumeTime && pendingResumeTime > 0) {
    return pendingResumeTime;
  }

  return stableCurrentTime > 1 ? stableCurrentTime : 0;
}

export function resolveSourceSwitchEpisodeAnchor({
  currentAnchor,
  activeDetail,
  activeEpisodeIndex,
}: ResolveSourceSwitchEpisodeAnchorOptions): SourceSwitchEpisodeAnchor {
  if (currentAnchor) {
    return currentAnchor;
  }

  return {
    detail: activeDetail,
    episodeIndex: Math.max(0, Math.floor(activeEpisodeIndex)),
  };
}

/**
 * 换源本身就是一次显式的目标集选择：
 * - 有有效进度时沿用当前集进度
 * - 否则强制从目标集开头起播，并阻止目标源旧历史反向覆盖
 */
export function resolveSourceSwitchResumeState({
  currentPlayTime,
  preserveProgress,
  clearTargetEpisodeProgress,
}: ResolveSourceSwitchResumeStateOptions): SourceSwitchResumeState {
  if (clearTargetEpisodeProgress) {
    return { resumeTime: 0, resumeMode: 'forced' };
  }

  if (preserveProgress && currentPlayTime > 1) {
    return {
      resumeTime: currentPlayTime,
      resumeMode: 'forced',
    };
  }

  return { resumeTime: 0, resumeMode: 'forced' };
}
