import type { IStorage, PlayRecord } from '@/lib/types';

export async function assertTrackingCalendar(storage: IStorage) {
  const base: PlayRecord = {
    title: '作品',
    year: '2026',
    cover: '',
    source_name: '源',
    index: 2,
    total_episodes: 5,
    play_time: 0,
    total_time: 60,
    save_time: 20,
    update_baseline_episodes: 4,
    update_detected_at: 1,
    search_title: '搜索名',
  };
  await storage.setPlayRecord('calendar-user', 'source+record', base);
  await storage.setPlayRecord('calendar-user', 'source+read', {
    ...base,
    update_baseline_episodes: 5,
  });
  await storage.setPlayRecord('calendar-user', 'source+disabled', {
    ...base,
    tracking_enabled: false,
  });
  await storage.setPlayRecord('calendar-user', 'source+ended', {
    ...base,
    series_status: 'ended',
    tracking_enabled: true,
  });
  await storage.setPlayRecord('other-user', 'source+other', base);
  await storage.setPlayRecord('calendar-user', 'source+group', {
    ...base,
    index: 20,
    total_episodes: 30,
    group_index: 2,
    group_total: 4,
    update_baseline_group_total: 3,
  });
  const favorite = {
    title: '收藏',
    year: '2026',
    cover: '',
    source_name: '源',
    total_episodes: 5,
    save_time: 30,
    update_baseline_episodes: 4,
    update_detected_at: 2,
  };
  for (const key of [
    'source+record',
    'source+disabled',
    'source+favorite',
    'douban+catalog',
  ])
    await storage.setFavorite('calendar-user', key, favorite);
  await storage.setFavorite('calendar-user', 'source+live', {
    ...favorite,
    origin: 'live',
  });
  await storage.setFavorite('calendar-user', 'source+favorite-read', {
    ...favorite,
    update_baseline_episodes: 5,
    save_time: 1,
  });
  const items = await storage.getTrackingCalendarItems('CALENDAR-USER');
  expect(new Set(items.map((item) => item.key))).toEqual(
    new Set([
      'source+record',
      'source+read',
      'source+group',
      'source+favorite',
      'source+favorite-read',
    ]),
  );
  expect(items[0].key).toBe('source+favorite');
  expect(items.find((item) => item.key === 'source+record')).toMatchObject({
    origin: 'record',
    searchTitle: '搜索名',
    episodeIndex: 2,
    totalEpisodes: 5,
    hasUpdate: true,
    updateDetectedAt: 1,
    airWeekday: null,
  });
  expect(items.find((item) => item.key === 'source+read')?.hasUpdate).toBe(
    false,
  );
  expect(items.find((item) => item.key === 'source+group')).toMatchObject({
    episodeIndex: 2,
    totalEpisodes: 4,
    hasUpdate: true,
  });
  expect(items.find((item) => item.key === 'source+favorite')).toMatchObject({
    origin: 'favorite',
    episodeIndex: null,
    totalEpisodes: 5,
    searchTitle: '',
    hasUpdate: true,
  });
  expect(await storage.getTrackingCalendarItems('empty-user')).toEqual([]);
  for (let i = 0; i < 205; i++)
    await storage.setPlayRecord('calendar-limit', `source+${i}`, {
      ...base,
      save_time: i,
    });
  const limited = await storage.getTrackingCalendarItems('calendar-limit');
  expect(limited).toHaveLength(200);
  expect(limited[0].key).toBe('source+204');
  expect(limited[199].key).toBe('source+5');
}
