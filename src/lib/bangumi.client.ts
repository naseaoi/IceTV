'use client';

export type { BangumiCalendarData } from './bangumi';
import type { BangumiCalendarData } from './bangumi';

export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  const response = await fetch('/api/bangumi/calendar');

  if (!response.ok) {
    throw new Error(`Bangumi calendar: ${response.status}`);
  }

  return (await response.json()) as BangumiCalendarData[];
}
