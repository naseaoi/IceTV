export type BufferedRange = readonly [start: number, end: number];

export interface LivePlaybackPauseContext {
  explicitUserPause: boolean;
  hasMediaError: boolean;
  expectedAbort: boolean;
  recoveryInProgress: boolean;
  runtimeCleaned: boolean;
}

const BUFFERED_POSITION_OFFSET_SECONDS = 0.05;
const BUFFERED_RANGE_TOLERANCE_SECONDS = 0.1;

export function shouldTreatLivePauseAsUserPause({
  explicitUserPause,
  hasMediaError,
  expectedAbort,
  recoveryInProgress,
  runtimeCleaned,
}: LivePlaybackPauseContext): boolean {
  if (explicitUserPause) return true;

  return !(
    hasMediaError ||
    expectedAbort ||
    recoveryInProgress ||
    runtimeCleaned
  );
}

export function readBufferedRanges(ranges: TimeRanges): BufferedRange[] {
  return Array.from({ length: ranges.length }, (_, index) => [
    ranges.start(index),
    ranges.end(index),
  ]);
}

export function resolveLiveRecoveryPosition(
  currentTime: number,
  liveSyncPosition: number | null | undefined,
  bufferedRanges: readonly BufferedRange[],
): number | null {
  const currentRange = bufferedRanges.find(
    ([start, end]) =>
      currentTime >= start - BUFFERED_RANGE_TOLERANCE_SECONDS &&
      currentTime < end - BUFFERED_RANGE_TOLERANCE_SECONDS,
  );
  if (currentRange) {
    return null;
  }

  const livePosition = Number(liveSyncPosition);
  if (!Number.isFinite(livePosition) || livePosition <= 0) {
    return null;
  }

  const liveRange = bufferedRanges.find(
    ([start, end]) => livePosition >= start && livePosition <= end,
  );
  if (!liveRange) {
    return null;
  }

  const [start, end] = liveRange;
  return Math.min(
    Math.max(livePosition, start + BUFFERED_POSITION_OFFSET_SECONDS),
    Math.max(start, end - BUFFERED_POSITION_OFFSET_SECONDS),
  );
}
