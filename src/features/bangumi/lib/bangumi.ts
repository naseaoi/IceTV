import {
  BANGUMI_CALENDAR_FRESH_SECONDS,
  BANGUMI_CALENDAR_MAX_AGE_SECONDS,
} from '@/features/home/lib/home-cache';

import {
  type BangumiFetchInit,
  fetchBangumiCalendarJson,
} from './bangumi-fetch';
import { normalizeBangumiCalendarData } from './bangumi-normalize';

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
const BANGUMI_CACHE_FRESH_MS = BANGUMI_CALENDAR_FRESH_SECONDS * 1000;
const BANGUMI_CACHE_MAX_AGE_MS = BANGUMI_CALENDAR_MAX_AGE_SECONDS * 1000;
const BANGUMI_MAX_ATTEMPTS = 2;

let bangumiCalendarCache:
  | {
      data: BangumiCalendarData[];
      freshUntil: number;
      staleUntil: number;
    }
  | undefined;

export async function getBangumiCalendarData(
  init: BangumiFetchInit = {},
): Promise<BangumiCalendarData[]> {
  const cachedData = getCachedBangumiCalendarData();

  if (cachedData) {
    return cachedData;
  }

  const staleData = getCachedBangumiCalendarData({ allowStale: true });
  const maxAttempts = init.timeoutMs ? 1 : BANGUMI_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await fetchBangumiCalendarJson(
        new URL(BANGUMI_CALENDAR_URL),
        init,
      );
      const calendarData = normalizeBangumiCalendarData(data);

      if (isUsableBangumiCalendarData(calendarData)) {
        const now = Date.now();
        bangumiCalendarCache = {
          data: calendarData,
          freshUntil: now + BANGUMI_CACHE_FRESH_MS,
          staleUntil: now + BANGUMI_CACHE_MAX_AGE_MS,
        };
        return calendarData;
      }

      if (attempt === maxAttempts) {
        if (staleData) {
          return staleData;
        }
        return calendarData;
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        if (staleData) {
          return staleData;
        }
        throw error;
      }
    }
  }

  return [];
}

export function getCachedBangumiCalendarData(
  options: {
    allowStale?: boolean;
  } = {},
): BangumiCalendarData[] | undefined {
  if (!bangumiCalendarCache) {
    return undefined;
  }

  const now = Date.now();
  if (bangumiCalendarCache.staleUntil <= now) {
    bangumiCalendarCache = undefined;
    return undefined;
  }

  if (!options.allowStale && bangumiCalendarCache.freshUntil <= now) {
    return undefined;
  }

  return bangumiCalendarCache.data;
}

function isUsableBangumiCalendarData(data: BangumiCalendarData[]): boolean {
  return data.some((item) => item.items.length > 0);
}
