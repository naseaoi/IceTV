import {
  normalizePlayRecordLimit,
  selectRecentPlayRecords,
} from '@/lib/play-records';

describe('play record selection', () => {
  it('limits invalid and oversized values', () => {
    expect(normalizePlayRecordLimit('invalid')).toBe(10);
    expect(normalizePlayRecordLimit(0)).toBe(10);
    expect(normalizePlayRecordLimit(1000)).toBe(100);
  });

  it('sorts records by save time before selecting', () => {
    const records = {
      old: { save_time: 1 } as never,
      new: { save_time: 3 } as never,
      middle: { save_time: 2 } as never,
    };

    expect(Object.keys(selectRecentPlayRecords(records, 2))).toEqual([
      'new',
      'middle',
    ]);
  });
});
