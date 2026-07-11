import {
  PLAYBACK_STALL_CONFIRMATION_DELAY_MS,
  resolvePlaybackStallDecision,
} from '@/features/play/lib/playbackStallRecovery';

describe('resolvePlaybackStallDecision', () => {
  it('连续缓冲充足时不修改播放位置', () => {
    expect(resolvePlaybackStallDecision(20, [[10, 30]])).toEqual({
      action: 'none',
      bufferedAhead: 10,
      gapToNext: null,
      targetTime: null,
    });
  });

  it('当前位置落在小缓冲缺口时跳到下一区间', () => {
    const result = resolvePlaybackStallDecision(20.1, [
      [10, 20],
      [20.2, 30],
    ]);

    expect(result).toMatchObject({
      action: 'seek',
      bufferedAhead: 0,
      targetTime: 20.25,
    });
    expect(result.gapToNext).toBeCloseTo(0.1);
  });

  it('即将到达小缓冲缺口时跳到下一区间', () => {
    const result = resolvePlaybackStallDecision(19.9, [
      [10, 20],
      [20.2, 30],
    ]);

    expect(result).toMatchObject({
      action: 'seek',
      targetTime: 20.25,
    });
    expect(result.bufferedAhead).toBeCloseTo(0.1);
    expect(result.gapToNext).toBeCloseTo(0.2);
  });

  it('没有可跨越的缓冲区时继续加载', () => {
    expect(resolvePlaybackStallDecision(20, [[10, 20]])).toEqual({
      action: 'load',
      bufferedAhead: 0,
      gapToNext: null,
      targetTime: null,
    });
  });

  it('使用短延迟确认瞬时停顿', () => {
    expect(PLAYBACK_STALL_CONFIRMATION_DELAY_MS).toBe(400);
  });
});
