import type { PlaybackStartTarget } from './playbackStartPolicy';

/** 只存起播决策的执行状态；详情迟到只刷新提示，不能再次自动推进。 */
export interface PlaybackStartState {
  parked: boolean;
  pendingDuration: PlaybackStartTarget | null;
  refreshPrompt?: () => void;
  showResumePrompt?: () => void;
}

export function clearPlaybackStartState(state: PlaybackStartState): void {
  state.parked = false;
  state.pendingDuration = null;
  state.refreshPrompt?.();
}
