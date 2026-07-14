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
  const safeActiveIndex = Math.max(0, Math.floor(activeEpisodeIndex));

  if (currentAnchor) {
    return {
      detail: currentAnchor.detail || activeDetail,
      episodeIndex: Math.max(currentAnchor.episodeIndex, safeActiveIndex),
    };
  }

  return {
    detail: activeDetail,
    episodeIndex: safeActiveIndex,
  };
}

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
