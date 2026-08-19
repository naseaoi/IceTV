import {
  hasPlayRecordUpdate,
  markPlayRecordUpdateRead,
  mergePlayRecordUpdateBaseline,
  normalizePlayRecordLimit,
  selectPlayRecordPage,
  selectRecentPlayRecords,
} from '@/lib/play-records';
import type { PlayRecord } from '@/lib/types';

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

  it('returns total and a cursor for subsequent pages', () => {
    const records = {
      first: { save_time: 3 } as never,
      second: { save_time: 2 } as never,
      third: { save_time: 1 } as never,
    };

    const firstPage = selectPlayRecordPage(records, 2);
    const secondPage = selectPlayRecordPage(records, 2, firstPage.nextCursor);

    expect(firstPage.total).toBe(3);
    expect(Object.keys(firstPage.items)).toEqual(['first', 'second']);
    expect(Object.keys(secondPage.items)).toEqual(['third']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('uses group progress when determining an update', () => {
    const record = {
      index: 8,
      total_episodes: 8,
      group_index: 2,
      group_total: 3,
      update_baseline_group_total: 2,
    } as PlayRecord;

    expect(hasPlayRecordUpdate(record)).toBe(true);
    expect(hasPlayRecordUpdate({ ...record, group_index: 3 })).toBe(false);
  });

  it('preserves the update baseline until the latest episode is watched', () => {
    const previous = {
      index: 1,
      total_episodes: 10,
      update_baseline_episodes: 10,
    } as PlayRecord;
    const updated = mergePlayRecordUpdateBaseline(previous, {
      ...previous,
      index: 1,
      total_episodes: 11,
    } as PlayRecord);

    expect(updated.update_baseline_episodes).toBe(10);
    expect(hasPlayRecordUpdate(updated)).toBe(true);
    expect(
      mergePlayRecordUpdateBaseline(updated, {
        ...updated,
        index: 11,
      } as PlayRecord).update_baseline_episodes,
    ).toBe(11);
  });

  it('hides updates while tracking is disabled and restores them when enabled', () => {
    const record = {
      index: 2,
      total_episodes: 4,
      update_baseline_episodes: 3,
      tracking_enabled: false,
    } as PlayRecord;

    expect(hasPlayRecordUpdate(record)).toBe(false);
    expect(hasPlayRecordUpdate({ ...record, tracking_enabled: true })).toBe(
      true,
    );
    expect(
      mergePlayRecordUpdateBaseline(record, {
        ...record,
        tracking_enabled: undefined,
      }).tracking_enabled,
    ).toBe(false);
  });

  it('marks the current available episode count as read', () => {
    const record = {
      index: 2,
      total_episodes: 4,
      update_baseline_episodes: 3,
    } as PlayRecord;

    const readRecord = markPlayRecordUpdateRead(record);
    expect(readRecord.update_baseline_episodes).toBe(4);
    expect(hasPlayRecordUpdate(readRecord)).toBe(false);
  });
});
