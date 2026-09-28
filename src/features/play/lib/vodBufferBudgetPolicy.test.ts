import {
  resolveVodBufferFullBudgetBytes,
  resolveVodForwardBufferLimits,
  VOD_FORWARD_BUFFER_BYTE_BUDGET,
  VOD_MIN_FORWARD_BUFFER_SECONDS,
} from '@/features/play/lib/vodBufferBudgetPolicy';

const DESKTOP = { maxBufferLength: 120, maxMaxBufferLength: 600 };
const MBPS = 1000 * 1000;

// hls.js getMaxBufferLength 的实际前向目标
function forwardTarget(
  limits: { maxBufferLength: number; maxMaxBufferLength: number },
  maxBufferSize: number,
  bitrate: number,
) {
  return Math.min(
    Math.max((8 * maxBufferSize) / bitrate, limits.maxBufferLength),
    limits.maxMaxBufferLength,
  );
}

describe('resolveVodForwardBufferLimits', () => {
  it('码率未知时保持原配置', () => {
    expect(resolveVodForwardBufferLimits(DESKTOP, null, null)).toEqual(DESKTOP);
    expect(resolveVodForwardBufferLimits(DESKTOP, 0, null)).toEqual(DESKTOP);
  });

  it('低码率源的前向目标已在预算内时保持原配置', () => {
    expect(resolveVodForwardBufferLimits(DESKTOP, 1.2 * MBPS, null)).toEqual(
      DESKTOP,
    );
    const xigua = { maxBufferLength: 120, maxMaxBufferLength: 300 };
    expect(resolveVodForwardBufferLimits(xigua, 2 * MBPS, null)).toEqual(xigua);
  });

  it('原前向目标在预算内时 hls.js 实际目标不变', () => {
    for (const bitrate of [0.5, 1, 2, 3, 5] as const) {
      const bps = bitrate * MBPS;
      const limits = resolveVodForwardBufferLimits(DESKTOP, bps, null);
      const before = forwardTarget(DESKTOP, 60 * MBPS, bps);
      const after = forwardTarget(limits, 60 * MBPS, bps);
      expect(after).toBe(before);
    }
  });

  it('高码率时把前向上限封到字节预算以内', () => {
    const limits = resolveVodForwardBufferLimits(DESKTOP, 10 * MBPS, null);
    expect(limits).toEqual({ maxBufferLength: 80, maxMaxBufferLength: 80 });
    expect(
      (forwardTarget(limits, 120 * MBPS, 10 * MBPS) * 10 * MBPS) / 8,
    ).toBeLessThanOrEqual(VOD_FORWARD_BUFFER_BYTE_BUDGET);
  });

  it('超高码率时不低于前向下限', () => {
    expect(resolveVodForwardBufferLimits(DESKTOP, 60 * MBPS, null)).toEqual({
      maxBufferLength: VOD_MIN_FORWARD_BUFFER_SECONDS,
      maxMaxBufferLength: VOD_MIN_FORWARD_BUFFER_SECONDS,
    });
  });

  it('bufferFullError 得出的配额优先于预算，且不受前向下限保护', () => {
    expect(
      resolveVodForwardBufferLimits(DESKTOP, 10 * MBPS, 50 * MBPS),
    ).toEqual({ maxBufferLength: 40, maxMaxBufferLength: 40 });
    expect(
      resolveVodForwardBufferLimits(DESKTOP, 10 * MBPS, 10 * MBPS),
    ).toEqual({ maxBufferLength: 8, maxMaxBufferLength: 8 });
  });
});

describe('resolveVodBufferFullBudgetBytes', () => {
  it('当前位置未缓冲或码率未知时不推算配额', () => {
    expect(
      resolveVodBufferFullBudgetBytes({
        forwardBufferedSeconds: 0.3,
        fragmentDurationSeconds: 10,
        bitrateBps: 10 * MBPS,
      }),
    ).toBeNull();
    expect(
      resolveVodBufferFullBudgetBytes({
        forwardBufferedSeconds: 60,
        fragmentDurationSeconds: 10,
        bitrateBps: null,
      }),
    ).toBeNull();
  });

  it('按当时前向缓冲留出余量，至少保留一个分片', () => {
    expect(
      resolveVodBufferFullBudgetBytes({
        forwardBufferedSeconds: 100,
        fragmentDurationSeconds: 10,
        bitrateBps: 10 * MBPS,
      }),
    ).toBe(100 * MBPS);
    expect(
      resolveVodBufferFullBudgetBytes({
        forwardBufferedSeconds: 5,
        fragmentDurationSeconds: 10,
        bitrateBps: 8 * MBPS,
      }),
    ).toBe(10 * MBPS);
  });
});
