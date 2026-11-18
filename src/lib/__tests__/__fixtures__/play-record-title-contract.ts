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
