import {
  BANGUMI_CALENDAR_FRESH_SECONDS,
  BANGUMI_CALENDAR_STALE_SECONDS,
} from '@/features/home/lib/home-cache';
import { createSharedServerCache } from '@/lib/shared-server-cache';

import {
  type BangumiFetchInit,
  fetchBangumiCalendarJson,
} from './bangumi-fetch';
import {
  isUsableBangumiCalendarData,
  normalizeBangumiCalendarData,
} from './bangumi-normalize';

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

const BANGUMI_CALENDAR_URL = 'https://api.bgm.tv/calendar';
const BANGUMI_MAX_ATTEMPTS = 2;

const bangumiCalendarCache = createSharedServerCache<BangumiCalendarData[]>({
  name: 'bangumi-calendar-v1',
  maxSize: 1,
  freshMs: BANGUMI_CALENDAR_FRESH_SECONDS * 1000,
  staleMs: BANGUMI_CALENDAR_STALE_SECONDS * 1000,
  shouldCache: isUsableBangumiCalendarData,
});

// 全站共用一份日历：过期后先返回旧数据并在后台刷新，刷新失败或拿到空数据时沿用未过最长保留期的旧数据
export async function getBangumiCalendarData(
  init: BangumiFetchInit = {},
): Promise<BangumiCalendarData[]> {
  let data: BangumiCalendarData[];
  try {
    data = await bangumiCalendarCache.getOrLoad(BANGUMI_CALENDAR_URL, () =>
      loadBangumiCalendarData(init),
    );
  } catch (error) {
    const stale = bangumiCalendarCache.peek(BANGUMI_CALENDAR_URL);
    if (stale) return stale.value;
    throw error;
  }

  if (isUsableBangumiCalendarData(data)) return data;
  return bangumiCalendarCache.peek(BANGUMI_CALENDAR_URL)?.value ?? data;
}

async function loadBangumiCalendarData(
  init: BangumiFetchInit,
): Promise<BangumiCalendarData[]> {
  const maxAttempts = init.timeoutMs ? 1 : BANGUMI_MAX_ATTEMPTS;
  let calendarData: BangumiCalendarData[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      calendarData = normalizeBangumiCalendarData(
        await fetchBangumiCalendarJson(new URL(BANGUMI_CALENDAR_URL), init),
      );
      if (isUsableBangumiCalendarData(calendarData)) return calendarData;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
    }
  }

  return calendarData;
}
