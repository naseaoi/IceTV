import {
  fetchBangumiCalendarJson,
  type BangumiFetchInit,
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
const BANGUMI_CACHE_MS = 60 * 60 * 1000;
const BANGUMI_MAX_ATTEMPTS = 2;

let bangumiCalendarCache:
  | {
      data: BangumiCalendarData[];
      expiresAt: number;
    }
  | undefined;

export async function getBangumiCalendarData(
  init: BangumiFetchInit = {},
): Promise<BangumiCalendarData[]> {
  const cachedData = getCachedBangumiCalendarData();

  if (cachedData) {
    return cachedData;
  }

  const maxAttempts = init.timeoutMs ? 1 : BANGUMI_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await fetchBangumiCalendarJson(
        new URL(BANGUMI_CALENDAR_URL),
        init,
      );
      const calendarData = normalizeBangumiCalendarData(data);

      if (isUsableBangumiCalendarData(calendarData)) {
        bangumiCalendarCache = {
          data: calendarData,
          expiresAt: Date.now() + BANGUMI_CACHE_MS,
        };
        return calendarData;
      }

      if (attempt === maxAttempts) {
        return calendarData;
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
    }
  }

  return [];
}

export function getCachedBangumiCalendarData():
  | BangumiCalendarData[]
  | undefined {
  if (!bangumiCalendarCache) {
    return undefined;
  }

  if (bangumiCalendarCache.expiresAt <= Date.now()) {
    bangumiCalendarCache = undefined;
    return undefined;
  }

  return bangumiCalendarCache.data;
}

function isUsableBangumiCalendarData(data: BangumiCalendarData[]): boolean {
  return data.some((item) => item.items.length > 0);
}
