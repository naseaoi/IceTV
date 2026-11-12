import {
  isPlayRecordShelved,
  selectPlayRecordPage,
  SHELVED_PLAY_RECORD_AGE_MS,
} from '@/lib/play-records';
import type { IStorage, PlaybackSession, PlayRecord } from '@/lib/types';

export async function assertStatsReuse(storage: IStorage) {
  const now = Date.now();
  const record: PlayRecord = {
    title: 'Show',
    source_name: 'A',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 2,
    play_time: 90,
    total_time: 100,
    save_time: now - SHELVED_PLAY_RECORD_AGE_MS - 1000,
  };
  const records: Record<string, PlayRecord> = {
    'a+old': record,
    'a+recent': { ...record, save_time: now },
    'a+finished': { ...record, index: 2 },
    'a+unfinished': { ...record, index: 2, play_time: 89 },
    'a+fractional': { ...record, index: 2, play_time: 90, total_time: 100.9 },
    'a+unknown-duration': { ...record, index: 2, total_time: 0 },
    'a+group-finished': { ...record, group_index: 2, group_total: 2 },
    'a+group-open': { ...record, index: 12, group_index: 1, group_total: 2 },
    'a+partial-group': { ...record, group_index: 2 },
  };
  await storage.setPlayRecords('reuse-user', records);
  await storage.setPlayRecord('reuse-other', 'a+other', record);
  let cursor: string | null = null;
  let seen = 0;
  do {
    const split = cursor?.indexOf('|') ?? -1;
    const page = await storage.getPlayRecordPage(
      'REUSE-USER',
      2,
      cursor ? Number(cursor.slice(0, split)) : undefined,
      cursor ? cursor.slice(split + 1) : undefined,
      'shelved',
    );
    expect(page).toEqual(
      selectPlayRecordPage(records, 2, cursor, { filter: 'shelved' }),
    );
    seen += Object.keys(page.items).length;
    cursor = page.nextCursor;
  } while (cursor);
  expect(seen).toBe(
    Object.values(records).filter((item) => isPlayRecordShelved(item, now))
      .length,
  );
  expect(
    isPlayRecordShelved(
      { ...record, save_time: now - SHELVED_PLAY_RECORD_AGE_MS },
      now,
    ),
  ).toBe(false);
  const session: PlaybackSession = {
    id: 'reuse-a',
    source: 'a',
    video_id: 'one',
    episode_index: 1,
    title: 'Show',
    source_name: 'Old A',
    year: '2026',
    cover: '',
    started_at: 100,
    ended_at: 200,
    watch_seconds: 60,
    last_position: 60,
    total_time: 100,
    created_at: 100,
    updated_at: 200,
  };
  await storage.setPlaybackSession('reuse-user', session);
  await storage.setPlaybackSession('reuse-other', {
    ...session,
    id: 'reuse-b',
    title: 'SHOW',
    source_name: 'Latest A',
    started_at: 150,
  });
  await storage.setPlaybackSession('reuse-user', {
    ...session,
    id: 'reuse-c',
    source: 'b',
    started_at: 199,
    watch_seconds: 20,
  });
  await storage.setPlaybackSession('reuse-user', {
    ...session,
    id: 'reuse-outside',
    source: 'b',
    started_at: 200,
  });
  const all = await storage.getPlaybackSourceUsage(100, 200);
  expect(all).toEqual([
    {
      source: 'a',
      sourceName: 'Latest A',
      watchSeconds: 120,
      userCount: 2,
      workCount: 1,
    },
    {
      source: 'b',
      sourceName: 'Old A',
      watchSeconds: 20,
      userCount: 1,
      workCount: 1,
    },
  ]);
  expect(
    await storage.getPlaybackSourceUsage(100, 200, ' REUSE-USER '),
  ).toEqual([
    {
      source: 'a',
      sourceName: 'Old A',
      watchSeconds: 60,
      userCount: 1,
      workCount: 1,
    },
    {
      source: 'b',
      sourceName: 'Old A',
      watchSeconds: 20,
      userCount: 1,
      workCount: 1,
    },
  ]);
  await storage.deleteUser('reuse-user');
  await storage.deleteUser('reuse-other');
}
