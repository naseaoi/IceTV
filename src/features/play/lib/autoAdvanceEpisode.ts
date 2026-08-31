interface AutoAdvanceEpisodeState {
  enabled: boolean;
  armed: boolean;
  alreadyAdvanced: boolean;
  currentEpisodeIndex: number;
  episodeCount: number;
}

const MAX_PREMATURE_END_GAP_RATIO = 0.15;
const MAX_PREMATURE_END_GAP_SECONDS = 90;

/**
 * MSE 异常时 video 会在中途触发 ended，此处用清单声明的总时长兜底，
 * 距离片尾过远的 ended 不视为播完。
 */
export function isTrustworthyPlaybackEnd(
  endedAt: number,
  declaredDuration: number | null | undefined,
): boolean {
  if (!Number.isFinite(declaredDuration) || (declaredDuration ?? 0) <= 0) {
    return true;
  }

  const total = declaredDuration as number;
  if (!Number.isFinite(endedAt) || endedAt < 0) {
    return true;
  }

  const allowedGap = Math.max(
    total * MAX_PREMATURE_END_GAP_RATIO,
    MAX_PREMATURE_END_GAP_SECONDS,
  );
  return total - endedAt <= allowedGap;
}

export function shouldAutoAdvanceEpisode({
  enabled,
  armed,
  alreadyAdvanced,
  currentEpisodeIndex,
  episodeCount,
}: AutoAdvanceEpisodeState): boolean {
  return (
    enabled &&
    armed &&
    !alreadyAdvanced &&
    currentEpisodeIndex >= 0 &&
    currentEpisodeIndex < episodeCount - 1
  );
}
