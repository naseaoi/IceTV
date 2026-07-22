import { resolveLiveRecoveryPosition } from './livePlaybackRecovery';

describe('live playback recovery', () => {
  it('keeps the current position when playable media is already buffered', () => {
    expect(
      resolveLiveRecoveryPosition(10, 28, [
        [9, 14],
        [24, 30],
      ]),
    ).toBeNull();
  });

  it('seeks to the live position only when that position is buffered', () => {
    expect(resolveLiveRecoveryPosition(10, 28, [[24, 30]])).toBe(28);
  });

  it('does not seek into an unbuffered live edge', () => {
    expect(resolveLiveRecoveryPosition(10, 28, [[12, 18]])).toBeNull();
  });

  it('keeps the recovery position inside the buffered range', () => {
    expect(resolveLiveRecoveryPosition(10, 30, [[24, 30]])).toBe(29.95);
  });

  it('ignores an unavailable live position', () => {
    expect(resolveLiveRecoveryPosition(10, null, [[24, 30]])).toBeNull();
  });
});
