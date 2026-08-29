import {
  formatLastActive,
  formatLastActiveTooltip,
  getInactiveDays,
  NEVER_ACTIVE_TEXT,
} from '@/features/admin/lib/userActivity';

const NOW = new Date('2026-08-29T12:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

describe('formatLastActive', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('缺少登录记录时返回从未登录', () => {
    expect(formatLastActive(undefined)).toBe(NEVER_ACTIVE_TEXT);
    expect(formatLastActive(0)).toBe(NEVER_ACTIVE_TEXT);
  });

  it('按跨度选择相对时间粒度', () => {
    expect(formatLastActive(NOW - 30_000)).toBe('刚刚');
    expect(formatLastActive(NOW - 5 * 60_000)).toBe('5 分钟前');
    expect(formatLastActive(NOW - 3 * 60 * 60_000)).toBe('3 小时前');
    expect(formatLastActive(NOW - 10 * DAY_MS)).toBe('10 天前');
  });

  it('超过 30 天回落到绝对日期', () => {
    expect(formatLastActive(NOW - 60 * DAY_MS)).toMatch(/2026/);
  });
});

describe('formatLastActiveTooltip', () => {
  it('无记录时不给出提示', () => {
    expect(formatLastActiveTooltip(undefined)).toBeUndefined();
    expect(formatLastActiveTooltip(0)).toBeUndefined();
  });

  it('有记录时包含年份', () => {
    expect(formatLastActiveTooltip(NOW)).toMatch(/2026/);
  });
});

describe('getInactiveDays', () => {
  it('无记录时返回 null', () => {
    expect(getInactiveDays(undefined, NOW)).toBeNull();
    expect(getInactiveDays(0, NOW)).toBeNull();
  });

  it('向下取整未登录天数', () => {
    expect(getInactiveDays(NOW - 90 * DAY_MS, NOW)).toBe(90);
    expect(getInactiveDays(NOW - (7 * DAY_MS + 3600_000), NOW)).toBe(7);
  });
});
