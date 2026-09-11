import {
  normalizeDanmakuRetrySeconds,
  parseDanmakuRetryAfter,
} from '@/features/play/lib/danmaku/cache-policy';

describe('danmaku retry policy', () => {
  it.each([
    [undefined, 60],
    [null, 60],
    ['', 60],
    ['invalid', 60],
    ['45', 45],
    ['1.5', 2],
    ['-1', 1],
    ['999999', 300],
  ])('normalizes retry header %s to %s seconds', (value, expected) => {
    expect(parseDanmakuRetryAfter(value)).toBe(expected);
  });

  it('supports a Retry-After date without an unbounded wait', () => {
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-09-07T00:00:00Z'));
    try {
      expect(parseDanmakuRetryAfter('Mon, 07 Sep 2026 00:00:30 GMT')).toBe(30);
      expect(normalizeDanmakuRetrySeconds(Number.NaN)).toBe(60);
    } finally {
      clock.mockRestore();
    }
  });
});
