import { formatRelativeTime } from '@/lib/relative-time';

describe('formatRelativeTime', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0).getTime();

  it('formats recent timestamps relatively', () => {
    expect(formatRelativeTime(0, now)).toBe('最近');
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3 小时前');
  });

  it('shows the year only for timestamps from another year', () => {
    expect(
      formatRelativeTime(new Date(2026, 8, 1).getTime(), now),
    ).not.toContain('2026');
    expect(formatRelativeTime(new Date(2025, 8, 1).getTime(), now)).toContain(
      '2025',
    );
  });
});
