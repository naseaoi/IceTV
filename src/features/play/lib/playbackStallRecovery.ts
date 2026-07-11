export type PlaybackBufferedRange = readonly [number, number];

export type PlaybackStallDecision = {
  action: 'none' | 'seek' | 'load';
  bufferedAhead: number;
  gapToNext: number | null;
  targetTime: number | null;
};

export const PLAYBACK_STALL_CONFIRMATION_DELAY_MS = 400;

export function resolvePlaybackStallDecision(
  currentTime: number,
  ranges: PlaybackBufferedRange[],
): PlaybackStallDecision {
  const normalizedTime =
    Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const normalizedRanges = ranges
    .filter(
      ([start, end]) =>
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start,
    )
    .sort(([leftStart], [rightStart]) => leftStart - rightStart);
  const activeRange = normalizedRanges.find(
    ([start, end]) => normalizedTime >= start && normalizedTime < end,
  );
  const nextRange = normalizedRanges.find(([start]) => start > normalizedTime);
  const bufferedAhead = activeRange ? activeRange[1] - normalizedTime : 0;
  const gapToNext = nextRange
    ? nextRange[0] - (activeRange ? activeRange[1] : normalizedTime)
    : null;

  if (bufferedAhead > 1.5) {
    return {
      action: 'none',
      bufferedAhead,
      gapToNext,
      targetTime: null,
    };
  }

  if (
    nextRange &&
    gapToNext !== null &&
    gapToNext > 0 &&
    gapToNext <= 1 &&
    (!activeRange || bufferedAhead <= 0.25)
  ) {
    const rangeDuration = nextRange[1] - nextRange[0];
    return {
      action: 'seek',
      bufferedAhead,
      gapToNext,
      targetTime: nextRange[0] + Math.min(0.05, rangeDuration / 2),
    };
  }

  return {
    action: 'load',
    bufferedAhead,
    gapToNext,
    targetTime: null,
  };
}
