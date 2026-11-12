import {
  hasPlayRecordUpdate,
  isTrackingEnabled,
  markPlayRecordUpdateRead,
  mergePlayRecordUpdateBaseline,
  normalizePlayRecordLimit,
  selectPlayRecordPage,
  selectRecentPlayRecords,
} from '@/lib/play-records';
import type { PlayRecord } from '@/lib/types';

describe('play record selection', () => {
  it.each([undefined, 'ongoing', 'ended'] as const)(
    '状态 %s 下显式开关优先',
    (series_status) => {
      expect(isTrackingEnabled({ series_status })).toBe(
        series_status !== 'ended',
      );
      expect(isTrackingEnabled({ series_status, tracking_enabled: true })).toBe(
        true,
      );
      expect(
        isTrackingEnabled({ series_status, tracking_enabled: false }),
      ).toBe(false);
    },
  );

  it('完结默认隐藏更新，手动开启恢复更新', () => {
    const record = {
      index: 1,
      total_episodes: 12,
      update_baseline_episodes: 10,
      series_status: 'ended',
    } as PlayRecord;
    expect(hasPlayRecordUpdate(record)).toBe(false);
    expect(hasPlayRecordUpdate({ ...record, tracking_enabled: true })).toBe(
      true,
    );
  });

  it('新状态覆盖旧状态，未知详情保留旧状态与手动开关', () => {
    const previous = {
      index: 1,
      total_episodes: 12,
      series_status: 'ended',
      tracking_enabled: true,
    } as PlayRecord;
    expect(
      mergePlayRecordUpdateBaseline(previous, {
        ...previous,
        series_status: undefined,
        tracking_enabled: undefined,
      }),
    ).toMatchObject({ series_status: 'ended', tracking_enabled: true });
    expect(
      mergePlayRecordUpdateBaseline(previous, {
        ...previous,
        series_status: 'ongoing',
      }).series_status,
    ).toBe('ongoing');
  });

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

  it('先按更新状态筛选再分页，游标记录移除仍能继续', () => {
    const base = {
      index: 1,
      total_episodes: 3,
      update_baseline_episodes: 2,
    } as PlayRecord;
    const records = {
      a: { ...base, save_time: 3 },
      b: { ...base, save_time: 3 },
      c: { ...base, save_time: 2, tracking_enabled: false },
      d: { ...base, save_time: 1 },
    };
    const options = { filter: 'updated' } as const;
    const first = selectPlayRecordPage(records, 1, undefined, options);
    expect(first).toEqual({
      items: { b: records.b },
      total: 3,
      nextCursor: '3|b',
    });
    expect(selectPlayRecordPage(records, 1, first.nextCursor, options)).toEqual(
      { items: { a: records.a }, total: 3, nextCursor: '3|a' },
    );
    expect(
      selectPlayRecordPage(
        { a: records.a, d: records.d },
        2,
        first.nextCursor,
        options,
      ),
    ).toEqual({
      items: { a: records.a, d: records.d },
      total: 2,
      nextCursor: null,
    });
    expect(selectPlayRecordPage(records, 10).total).toBe(4);
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

  it('rebuilds the baseline when switching to a longer group', () => {
    const season1 = {
      index: 10,
      total_episodes: 34,
      group_label: '第一季',
      group_index: 10,
      group_total: 10,
      update_baseline_group_total: 10,
    } as PlayRecord;
    const merged = mergePlayRecordUpdateBaseline(season1, {
      index: 11,
      total_episodes: 34,
      group_label: '第二季',
      group_index: 1,
      group_total: 24,
    } as PlayRecord);

    expect(merged.update_baseline_group_total).toBe(24);
    expect(hasPlayRecordUpdate(merged)).toBe(false);
  });

  it('rebuilds the baseline when switching to a shorter group', () => {
    const season2 = {
      index: 34,
      total_episodes: 34,
      group_label: '第二季',
      group_index: 24,
      group_total: 24,
      update_baseline_group_total: 24,
    } as PlayRecord;
    const merged = mergePlayRecordUpdateBaseline(season2, {
      index: 3,
      total_episodes: 34,
      group_label: '第一季',
      group_index: 3,
      group_total: 10,
    } as PlayRecord);

    expect(merged.update_baseline_group_total).toBe(10);

    const grown = mergePlayRecordUpdateBaseline(merged, {
      ...merged,
      group_total: 12,
      total_episodes: 36,
    } as PlayRecord);
    expect(grown.update_baseline_group_total).toBe(10);
    expect(hasPlayRecordUpdate(grown)).toBe(true);
  });

  it('keeps the baseline when the group total grows within the same group', () => {
    const previous = {
      index: 3,
      total_episodes: 34,
      group_label: '第一季',
      group_index: 3,
      group_total: 10,
      update_baseline_group_total: 10,
    } as PlayRecord;
    const merged = mergePlayRecordUpdateBaseline(previous, {
      ...previous,
      group_total: 12,
      total_episodes: 36,
    } as PlayRecord);

    expect(merged.update_baseline_group_total).toBe(10);
    expect(hasPlayRecordUpdate(merged)).toBe(true);
  });

  it('falls back to the episode scale when group_index is missing', () => {
    const record = {
      index: 5,
      total_episodes: 20,
      group_total: 10,
      update_baseline_group_total: 10,
      update_baseline_episodes: 10,
    } as PlayRecord;

    expect(hasPlayRecordUpdate(record)).toBe(true);
    expect(markPlayRecordUpdateRead(record).update_baseline_episodes).toBe(20);
  });

  it.each(['简中 8', '简中8'])(
    '保存播放进度时兼容旧分组标签 %s，不吞掉新增集数',
    (label) => {
      const previous = {
        index: 16,
        total_episodes: 16,
        group_label: label,
        group_index: 8,
        group_total: 8,
        update_baseline_group_total: 8,
      } as PlayRecord;
      const merged = mergePlayRecordUpdateBaseline(previous, {
        ...previous,
        index: 17,
        total_episodes: 18,
        group_label: '简中',
        group_total: 9,
      });

      expect(merged.update_baseline_group_total).toBe(8);
      expect(hasPlayRecordUpdate(merged)).toBe(true);
    },
  );
});
