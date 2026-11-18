/** @jest-environment node */
import type Database from 'better-sqlite3';

import type { BangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { getBangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { assertTrackingCalendar } from '@/lib/__tests__/__fixtures__/tracking-calendar-contract';
import { db } from '@/lib/db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

import type { TrackingCalendarItem } from './tracking-calendar';
import {
  getTrackingCalendar,
  matchCalendarWeekdays,
} from './tracking-calendar.server';

jest.mock('@/features/bangumi/lib/bangumi', () => ({
  getBangumiCalendarData: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { getTrackingCalendarItems: jest.fn() } }));
const base: TrackingCalendarItem = {
  key: 'source+1',
  source: 'source',
  id: '1',
  title: '作品 A',
  searchTitle: '',
  year: '2026',
  cover: '',
  origin: 'record',
  episodeIndex: 1,
  totalEpisodes: 5,
  hasUpdate: false,
  updateDetectedAt: 1,
  airWeekday: null,
};
const calendar = [
  {
    weekday: { en: 'Mon' },
    items: [
      { name: 'Original Title', name_cn: '作品.A', air_date: '2026-01-01' },
    ],
  },
] as BangumiCalendarData[];
it('SQLite 周历筛选、用户隔离、去重与上限', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  try {
    await assertTrackingCalendar(storage);
  } finally {
    (storage as unknown as { db: Database.Database }).db.close();
  }
});
it('Bangumi 中文和原名按归一化标题与精确年份匹配', () => {
  const items = matchCalendarWeekdays(
    [
      base,
      { ...base, title: 'original-title' },
      { ...base, year: '' },
      { ...base, year: '2025' },
      { ...base, year: 'unknown' },
    ],
    calendar,
  );
  expect(items.map((item) => item.airWeekday)).toEqual([
    1,
    1,
    null,
    null,
    null,
  ]);
  expect(items[0].updateDetectedAt).toBe(1);
});
it('歧义播出日不猜测，非法日期与星期不匹配', () => {
  const conflict = [...calendar, { ...calendar[0], weekday: { en: 'Sun' } }];
  expect(matchCalendarWeekdays([base], conflict)[0].airWeekday).toBeNull();
  expect(
    matchCalendarWeekdays(
      [base],
      [{ ...calendar[0], weekday: { en: 'unknown' } }],
    )[0].airWeekday,
  ).toBeNull();
});
it('日历请求失败保留原始条目与历史更新时间，空列表不回源', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.mocked(db.getTrackingCalendarItems).mockResolvedValue([base]);
  jest.mocked(getBangumiCalendarData).mockRejectedValue(new Error('upstream'));
  expect(await getTrackingCalendar('user')).toEqual([base]);
  jest.mocked(getBangumiCalendarData).mockClear();
  jest.mocked(db.getTrackingCalendarItems).mockResolvedValue([]);
  expect(await getTrackingCalendar('user')).toEqual([]);
  expect(getBangumiCalendarData).not.toHaveBeenCalled();
  warn.mockRestore();
});
