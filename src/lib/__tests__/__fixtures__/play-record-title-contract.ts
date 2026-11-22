import type { IStorage, PlayRecord } from '@/lib/types';

export async function assertPlayRecordTitleLookup(storage: IStorage) {
  const record: PlayRecord = {
    title: ' Ａ·Ｂ 测试 ',
    year: '2024',
    source_name: '源',
    cover: '',
    index: 2,
    total_episodes: 3,
    play_time: 110,
    total_time: 1000,
    save_time: 100,
  };
  await storage.setPlayRecord('title-user', 'a+1', record);
  await storage.setPlayRecord('title-user', 'b+2', {
    ...record,
    save_time: 200,
  });
  await storage.setPlayRecord('other-user', 'c+3', {
    ...record,
    save_time: 500,
  });
  await storage.setPlayRecord('title-user', 'd+4', {
    ...record,
    year: '2025',
    save_time: 300,
  });
  expect(
    await storage.getLatestPlayRecordByTitle('title-user', 'ab测试', '2024'),
  ).toEqual({ 'b+2': { ...record, save_time: 200 } });
  expect(
    Object.keys(
      await storage.getLatestPlayRecordByTitle('title-user', 'ab测试', ''),
    ),
  ).toEqual(['d+4']);
  expect(
    await storage.getLatestPlayRecordByTitle('title-user', 'ab测试', '2026'),
  ).toEqual({});
}

export async function assertPlayRecordDeduplication(storage: IStorage) {
  const user = 'dedupe-user';
  const record: PlayRecord = {
    title: ' Ａ·Ｂ 测试 ',
    year: '2024',
    source_name: '源',
    cover: '',
    index: 2,
    total_episodes: 3,
    play_time: 110,
    total_time: 1000,
    save_time: 1,
    progress_session_id: 'old-session',
    progress_sequence: 10,
  };
  const first = { k: 'n:1', t: 30, d: 100, at: 100 };
  const newerFirst = { ...first, t: 55, at: 200 };
  const second = { k: 'n:2', t: 7, d: 90, at: 140 };
  const third = { k: 'g:第 2 季|n:1', t: 25, d: 200, at: 150 };
  const localIndex = { k: 'i:a:2', t: 21, d: 90, at: 160 };
  const foreignIndex = { ...localIndex, k: 'i:b:2', at: 180 };
  const protectedProgress = [{ ...second, k: 'n:42', at: 999 }];
  const keep = { ...record, save_time: 1000, episode_progress: [first] };
  await storage.setPlayRecords(user, {
    'a+keep': keep,
    'b+deduped': {
      ...record,
      title: 'ab测试！',
      save_time: 999,
      progress_session_id: 'duplicate-session',
      progress_sequence: 50,
      episode_progress: [newerFirst, foreignIndex, second],
    },
    'a+deduped': {
      ...record,
      save_time: 997,
      episode_progress: [localIndex, third],
    },
    'c+protected': {
      ...record,
      save_time: 998,
      episode_progress: protectedProgress,
    },
    'd+other-year': { ...record, year: '2025', save_time: 997 },
    'e+space-year': { ...record, year: ' 2024 ', save_time: 996 },
    'f+missing-year': { ...record, year: '', save_time: 995 },
    'g+unknown-year': { ...record, year: 'unknown', save_time: 994 },
    'h+empty-title': { ...record, title: ' ！ ', save_time: 993 },
    'i+outside-scan': record,
    ...Object.fromEntries(
      Array.from({ length: 491 }, (_, index) => [
        `filler+${index}`,
        { ...record, title: '其他作品', save_time: index + 2 },
      ]),
    ),
  });
  await storage.setPlayRecord('another-user', 'b+deduped', record);

  for (const keepKey of [
    'missing+key',
    'f+missing-year',
    'g+unknown-year',
    'h+empty-title',
  ]) {
    await expect(
      storage.deduplicatePlayRecords(user, keepKey),
    ).resolves.toEqual([]);
  }
  await expect(
    storage.deduplicatePlayRecords(user.toUpperCase(), 'a+keep', 'c+protected'),
  ).resolves.toEqual(['b+deduped', 'a+deduped']);
  const remaining = await storage.getAllPlayRecords(user);
  expect(remaining['b+deduped']).toBeUndefined();
  expect(remaining['a+deduped']).toBeUndefined();
  expect(remaining['a+keep']).toEqual({
    ...keep,
    episode_progress: [newerFirst, localIndex, third, second],
  });
  expect(remaining).toMatchObject({
    'c+protected': {
      ...record,
      save_time: 998,
      episode_progress: protectedProgress,
    },
    'd+other-year': { year: '2025' },
    'e+space-year': { year: ' 2024 ' },
    'f+missing-year': { year: '' },
    'i+outside-scan': record,
  });
  await expect(
    storage.getPlayRecordSnapshot(user, 'b+deduped'),
  ).resolves.toBeNull();
  await expect(
    storage.getPlayRecord('another-user', 'b+deduped'),
  ).resolves.toEqual(record);

  const concurrentUser = 'dedupe-concurrent';
  await storage.setPlayRecords(concurrentUser, {
    'a+1': { ...record, episode_progress: [first] },
    'b+2': { ...record, episode_progress: [second] },
  });
  const results = await Promise.all([
    storage.deduplicatePlayRecords(concurrentUser, 'a+1'),
    storage.deduplicatePlayRecords(concurrentUser, 'b+2'),
  ]);
  expect(results.flat()).toHaveLength(1);
  expect(
    Object.values(await storage.getAllPlayRecords(concurrentUser)),
  ).toEqual([{ ...record, episode_progress: [second, first] }]);
}
