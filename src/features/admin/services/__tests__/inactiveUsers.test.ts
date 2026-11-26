import {
  MAX_INACTIVE_DAYS,
  parseInactiveDays,
} from '@/features/admin/services/inactiveUsers';

describe('parseInactiveDays', () => {
  it('拒绝非数字与越界值', () => {
    expect(parseInactiveDays('30')).toBeNull();
    expect(parseInactiveDays(undefined)).toBeNull();
    expect(parseInactiveDays(NaN)).toBeNull();
    expect(parseInactiveDays(Infinity)).toBeNull();
    expect(parseInactiveDays(0)).toBeNull();
    expect(parseInactiveDays(-5)).toBeNull();
    expect(parseInactiveDays(MAX_INACTIVE_DAYS + 1)).toBeNull();
  });

  it('接受范围内的值并向下取整', () => {
    expect(parseInactiveDays(1)).toBe(1);
    expect(parseInactiveDays(90.7)).toBe(90);
    expect(parseInactiveDays(MAX_INACTIVE_DAYS)).toBe(MAX_INACTIVE_DAYS);
  });
});
