import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import type { SearchResult } from '@/lib/types';

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

// 换源、重试与播放器重建共用；目标集尚未起播时播放器上的时间属于上一集，只能沿用目标集的原恢复点
export function resolveActivePlayTime({
  targetEpisodePending,
  ...times
}: ResolveSourceSwitchCurrentPlayTimeOptions & {
  targetEpisodePending: boolean;
}): number {
  return targetEpisodePending
    ? (times.pendingResumeTime ?? 0)
    : resolveSourceSwitchCurrentPlayTime(times);
}

export function resolveSourceSwitchEpisodeAnchor({
  currentAnchor,
  activeDetail,
  activeEpisodeIndex,
}: ResolveSourceSwitchEpisodeAnchorOptions): SourceSwitchEpisodeAnchor {
  const safeActiveIndex = Math.max(0, Math.floor(activeEpisodeIndex));

  if (currentAnchor) {
    return currentAnchor;
  }

  return {
    detail: activeDetail,
    episodeIndex: safeActiveIndex,
  };
}

export function resolveSourceSwitchResumeState({
  currentPlayTime,
  preserveProgress,
}: ResolveSourceSwitchResumeStateOptions): SourceSwitchResumeState {
  if (preserveProgress && currentPlayTime > 1) {
    return {
      resumeTime: currentPlayTime,
      resumeMode: 'forced',
    };
  }

  return { resumeTime: 0, resumeMode: 'forced' };
}
