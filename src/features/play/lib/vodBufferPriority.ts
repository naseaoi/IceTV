export type BufferedVideoLike = Pick<
  HTMLVideoElement,
  'buffered' | 'currentTime'
>;

const BUFFER_RANGE_TOLERANCE_SECONDS = 0.5;

export function getForwardBufferSeconds(video: BufferedVideoLike): number {
  const currentTime = Number.isFinite(video.currentTime)
    ? video.currentTime
    : 0;
  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (
      start <= currentTime + BUFFER_RANGE_TOLERANCE_SECONDS &&
      end > currentTime
    ) {
      return Math.max(0, end - currentTime);
    }
  }
  return 0;
}
