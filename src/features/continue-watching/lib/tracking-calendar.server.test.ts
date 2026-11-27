/** @jest-environment node */
import type Database from 'better-sqlite3';
import { cookies } from 'next/headers';

import type { BangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import {
  getBangumiCalendarData,
  peekBangumiCalendarData,
} from '@/features/bangumi/lib/bangumi';
import { assertTrackingCalendar } from '@/lib/__tests__/__fixtures__/tracking-calendar-contract';
import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

import type { TrackingCalendarItem } from './tracking-calendar';
import {
  getTrackingStrip,
  getTrackingStripSkeletonCount,
  matchCalendarWeekdays,
} from './tracking-calendar.server';

jest.mock('@/features/bangumi/lib/bangumi', () => ({
  getBangumiCalendarData: jest.fn(),
  peekBangumiCalendarData: jest.fn(),
}));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/auth-session.server', () => ({
  getServerAuthSession: jest.fn(),
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
it('追更区只保留有更新与日历命中的作品，日历失败时只剩有更新', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const updated = {
    ...base,
    key: 'source+2',
    title: '作品 B',
    hasUpdate: true,
  };
  const stale = { ...base, key: 'source+3', title: '旧作' };
  jest
    .mocked(db.getTrackingCalendarItems)
    .mockResolvedValue([base, updated, stale]);
  jest.mocked(getBangumiCalendarData).mockResolvedValue(calendar);
  const result = await getTrackingStrip('user');
  expect(result.complete).toBe(true);
  expect(result.items.map((item) => item.key)).toEqual([
    'source+2',
    'source+1',
  ]);

  jest.mocked(getBangumiCalendarData).mockRejectedValue(new Error('upstream'));
  expect(await getTrackingStrip('user')).toEqual({
    items: [updated],
    complete: true,
  });

  jest.mocked(getBangumiCalendarData).mockClear();
  jest.mocked(db.getTrackingCalendarItems).mockResolvedValue([]);
  expect(await getTrackingStrip('user')).toEqual({ items: [], complete: true });
  expect(getBangumiCalendarData).not.toHaveBeenCalled();
  warn.mockRestore();
});
it('日历超过等待上限时先返回有更新的作品并标记未完成', async () => {
  const updated = { ...base, key: 'source+2', hasUpdate: true };
  jest.mocked(db.getTrackingCalendarItems).mockResolvedValue([base, updated]);
  jest
    .mocked(getBangumiCalendarData)
    .mockReturnValue(new Promise<BangumiCalendarData[]>(() => {}));
  expect(await getTrackingStrip('user', { bangumiWaitMs: 5 })).toEqual({
    items: [updated],
    complete: false,
  });
});

it('骨架计数实时查库，按追更区口径只读已缓存日历并截断到上限', async () => {
  const updated = { ...base, key: 'source+2', hasUpdate: true };
  const unscheduled = { ...base, key: 'source+3', title: '作品 C' };
  jest.mocked(getBangumiCalendarData).mockClear();
  jest.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'auth' ? { value: 'token' } : undefined),
  } as never);
  jest
    .mocked(getServerAuthSession)
    .mockResolvedValue({ status: 'authenticated', username: 'user' } as never);
  jest
    .mocked(db.getTrackingCalendarItems)
    .mockResolvedValue([base, updated, unscheduled]);

  jest.mocked(peekBangumiCalendarData).mockReturnValue(calendar);
  expect(await getTrackingStripSkeletonCount(8)).toBe(2);
  expect(await getTrackingStripSkeletonCount(1)).toBe(1);

  jest.mocked(peekBangumiCalendarData).mockReturnValue(null);
  expect(await getTrackingStripSkeletonCount(8)).toBe(1);
  expect(getBangumiCalendarData).not.toHaveBeenCalled();

  jest
    .mocked(getServerAuthSession)
    .mockResolvedValue({ status: 'unauthenticated' } as never);
  expect(await getTrackingStripSkeletonCount(8)).toBe(0);
});
