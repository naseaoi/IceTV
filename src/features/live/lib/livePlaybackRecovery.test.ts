import {
  resolveLiveRecoveryPosition,
  shouldTreatLivePauseAsUserPause,
} from './livePlaybackRecovery';

describe('live playback recovery', () => {
  const normalPauseContext = {
    explicitUserPause: false,
    hasMediaError: false,
    expectedAbort: false,
    recoveryInProgress: false,
    runtimeCleaned: false,
  };

  it('treats an ordinary pause as user intent', () => {
    expect(shouldTreatLivePauseAsUserPause(normalPauseContext)).toBe(true);
  });

  it.each([
    ['decoder error', { hasMediaError: true }],
    ['expected source abort', { expectedAbort: true }],
    ['playback recovery', { recoveryInProgress: true }],
    ['runtime cleanup', { runtimeCleaned: true }],
  ])('preserves autoplay intent during %s', (_name, overrides) => {
    expect(
      shouldTreatLivePauseAsUserPause({
        ...normalPauseContext,
        ...overrides,
      }),
    ).toBe(false);
  });

  it('keeps an explicit user pause during playback recovery', () => {
    expect(
      shouldTreatLivePauseAsUserPause({
        ...normalPauseContext,
        explicitUserPause: true,
        recoveryInProgress: true,
      }),
    ).toBe(true);
  });

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
