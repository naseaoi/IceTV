import { hasPlayRecordUpdate, selectPlayRecordPage } from '@/lib/play-records';
import type { IStorage, PlayRecord } from '@/lib/types';

export async function assertUpdatedPlayRecordPage(
  storage: IStorage,
): Promise<void> {
  const record: PlayRecord = {
    title: '剧集',
    source_name: '源',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 12,
    update_baseline_episodes: 10,
    play_time: 0,
    total_time: 0,
    save_time: 100,
  };
  const records: Record<string, PlayRecord> = {
    'source+a': { ...record, update_detected_at: 900 },
    'source+b': { ...record, update_detected_at: 1 },
    'source+c': {
      ...record,
      save_time: 50,
      group_index: 1,
      group_total: 3,
      update_baseline_group_total: 2,
    },
    'source+disabled': { ...record, tracking_enabled: false },
    'source+ended': { ...record, series_status: 'ended' },
    'source+enabled': {
      ...record,
      series_status: 'ended',
      tracking_enabled: true,
      save_time: 40,
    },
    'source+watched': { ...record, index: 12 },
    'source+read': { ...record, update_baseline_episodes: 12 },
    'source+legacy': { ...record, update_baseline_episodes: undefined },
    'source+partial-group': {
      ...record,
      group_total: 3,
      update_baseline_group_total: 3,
      save_time: 20,
    },
  };
  await storage.setPlayRecords('page-user', records);
  await storage.setPlayRecord('other-user', 'source+other', record);
  const expectedTotal =
    Object.values(records).filter(hasPlayRecordUpdate).length;
  const unread = await storage.getUnreadTrackingPlayRecordPage('page-user', 1);
  expect(unread.total).toBe(expectedTotal);
  let cursor: string | null = null;
  const keys: string[] = [];
  do {
    const expected = selectPlayRecordPage(records, 2, cursor, {
      filter: 'updated',
    });
    const separator = cursor?.indexOf('|') ?? -1;
    const page = await storage.getPlayRecordPage(
      'PAGE-USER',
      2,
      cursor ? Number(cursor.slice(0, separator)) : undefined,
      cursor ? cursor.slice(separator + 1) : undefined,
      'updated',
    );
    expect(page).toEqual(expected);
    expect(page.total).toBe(unread.total);
    keys.push(...Object.keys(page.items));
    cursor = page.nextCursor;
  } while (cursor);
  expect(keys).toEqual([
    'source+b',
    'source+a',
    'source+c',
    'source+enabled',
    'source+partial-group',
  ]);
  expect((await storage.getPlayRecordPage('page-user', 100)).total).toBe(
    Object.keys(records).length,
  );
  expect(
    await storage.getPlayRecordPage(
      'empty-user',
      2,
      undefined,
      undefined,
      'updated',
    ),
  ).toEqual({ items: {}, total: 0, nextCursor: null });
}

export async function assertBatchDeletePlayRecords(
  storage: IStorage,
): Promise<void> {
  const record: PlayRecord = {
    title: '剧集',
    source_name: '源',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 12,
    update_baseline_episodes: 10,
    play_time: 0,
    total_time: 0,
    save_time: 100,
  };
  await storage.setPlayRecords('delete-user', {
    'source+a': record,
    'source+b': record,
    'source+keep': record,
  });
  await storage.setPlayRecord('other-user', 'source+a', record);
  await storage.deletePlayRecords('DELETE-USER', []);
  expect((await storage.getPlayRecordPage('delete-user', 10)).total).toBe(3);
  await storage.deletePlayRecords('DELETE-USER', [
    'source+a',
    'source+b',
    'source+a',
    'source+missing',
  ]);
  expect(await storage.getAllPlayRecords('delete-user')).toEqual({
    'source+keep': record,
  });
  expect(await storage.getPlayRecord('other-user', 'source+a')).toEqual(record);
  expect(
    (await storage.getUnreadTrackingPlayRecordPage('delete-user', 10)).total,
  ).toBe(1);
}
