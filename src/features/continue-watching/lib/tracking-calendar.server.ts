import { cookies } from 'next/headers';

import {
  type BangumiCalendarData,
  getBangumiCalendarData,
  peekBangumiCalendarData,
} from '@/features/bangumi/lib/bangumi';
import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';

import {
  type TrackingCalendarItem,
  type TrackingStripSeed,
  isTrackingStripItem,
  sortTrackingStrip,
} from './tracking-calendar';

// 页面首屏等待日历的上限：共享缓存命中即刻返回，冷启动超时则先只给有更新的作品
const PAGE_BANGUMI_WAIT_MS = 800;

// Bangumi 日历的 weekday.en 为 Mon、Thu 等缩写
const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export function matchCalendarWeekdays(
  items: TrackingCalendarItem[],
  calendar: BangumiCalendarData[],
): TrackingCalendarItem[] {
  const schedules = new Map<string, number | null>();
  for (const day of calendar) {
    const weekday =
      weekdays.indexOf(day.weekday.en.slice(0, 3).toLowerCase()) + 1;
    if (!weekday) continue;
    for (const subject of day.items) {
      const year = /^(\d{4})-\d{2}-\d{2}$/.exec(subject.air_date)?.[1];
      if (!year) continue;
      for (const title of [subject.name_cn, subject.name]) {
        const normalized = normalizeWorkTitle(title);
        if (!normalized) continue;
        const key = JSON.stringify([normalized, year]);
        // 同名同年却有不同播出日时保持未知，避免给出无法判定的星期。
        schedules.set(
          key,
          schedules.has(key) && schedules.get(key) !== weekday ? null : weekday,
        );
      }
    }
  }
  return items.map((item) => {
    const year = normalizeWorkYear(item.year);
    const key = JSON.stringify([normalizeWorkTitle(item.title), year]);
    return { ...item, airWeekday: year ? (schedules.get(key) ?? null) : null };
  });
}

function toStripItems(
  items: TrackingCalendarItem[],
  calendar: BangumiCalendarData[] | null,
): TrackingCalendarItem[] {
  return sortTrackingStrip(
    (calendar ? matchCalendarWeekdays(items, calendar) : items).filter(
      isTrackingStripItem,
    ),
  );
}

export interface TrackingStripResult {
  items: TrackingCalendarItem[];
  // false 表示日历未在等待上限内返回，播出日可能缺失，客户端应重新请求
  complete: boolean;
}

export async function getTrackingStrip(
  username: string,
  { bangumiWaitMs }: { bangumiWaitMs?: number } = {},
): Promise<TrackingStripResult> {
  const items = await db.getTrackingCalendarItems(username);
  if (!items.length) return { items: [], complete: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const calendar = getBangumiCalendarData();
    const result =
      bangumiWaitMs === undefined
        ? await calendar
        : await Promise.race([
            calendar,
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), bangumiWaitMs);
            }),
          ]);
    return { items: toStripItems(items, result), complete: result !== null };
  } catch (error) {
    console.warn('追更播出日加载失败', error);
    return { items: toStripItems(items, null), complete: true };
  } finally {
    clearTimeout(timer);
  }
}

// 登录写计数 cookie 用：不等待上游，日历未缓存时只计有更新的作品
export async function countTrackingStrip(username: string): Promise<number> {
  const items = await db.getTrackingCalendarItems(username);
  return toStripItems(items, peekBangumiCalendarData()).length;
}

const EMPTY_SEED: TrackingStripSeed = {
  items: [],
  complete: false,
  fetchedAt: 0,
};

export async function getTrackingStripPageData(): Promise<TrackingStripSeed> {
  const authCookie = (await cookies()).get('auth')?.value;
  if (!authCookie) return EMPTY_SEED;
  const session = await getServerAuthSession(authCookie);
  if (session.status !== 'authenticated') return EMPTY_SEED;
  try {
    const fetchedAt = Date.now();
    const result = await getTrackingStrip(session.username, {
      bangumiWaitMs: PAGE_BANGUMI_WAIT_MS,
    });
    return { ...result, fetchedAt };
  } catch (error) {
    console.error('获取追更首屏数据失败:', error);
    return EMPTY_SEED;
  }
}
