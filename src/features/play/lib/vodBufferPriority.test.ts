import { getForwardBufferSeconds } from '@/features/play/lib/vodBufferPriority';

function createVideo(currentTime: number, ranges: Array<[number, number]>) {
  return {
    currentTime,
    buffered: {
      length: ranges.length,
      start: (index: number) => ranges[index][0],
      end: (index: number) => ranges[index][1],
    },
  } as Pick<HTMLVideoElement, 'buffered' | 'currentTime'>;
}

describe('VOD buffer priority', () => {
  it('reads the forward buffer containing the current position', () => {
    const video = createVideo(60, [
      [0, 30],
      [59.8, 84],
    ]);

    expect(getForwardBufferSeconds(video)).toBe(24);
  });
});
