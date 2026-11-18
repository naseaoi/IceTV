import {
  type BangumiCalendarData,
  getBangumiCalendarData,
} from '@/features/bangumi/lib/bangumi';
import { db } from '@/lib/db';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';

import type { TrackingCalendarItem } from './tracking-calendar';

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
export async function getTrackingCalendar(
  username: string,
): Promise<TrackingCalendarItem[]> {
  const items = await db.getTrackingCalendarItems(username);
  if (!items.length) return [];
  try {
    return matchCalendarWeekdays(items, await getBangumiCalendarData());
  } catch (error) {
    console.warn('追剧周历播出日加载失败', error);
    return items;
  }
}
