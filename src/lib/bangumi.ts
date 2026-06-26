import { normalizeBangumiCalendarData } from './bangumi-normalize';
import { fetchJsonThroughProxy, getProxyUrlForTarget } from './http-proxy-json';

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

type BangumiFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

const BANGUMI_CALENDAR_URL = 'https://api.bgm.tv/calendar';
const BANGUMI_CACHE_MS = 60 * 60 * 1000;
const BANGUMI_PROXY_TIMEOUT_MS = 15000;

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

  const data = await fetchBangumiCalendarJson(init);
  const calendarData = normalizeBangumiCalendarData(data);

  bangumiCalendarCache = {
    data: calendarData,
    expiresAt: Date.now() + BANGUMI_CACHE_MS,
  };

  return calendarData;
}

async function fetchBangumiCalendarJson(
  init: BangumiFetchInit,
): Promise<unknown> {
  const targetUrl = new URL(BANGUMI_CALENDAR_URL);
  const proxyUrl = getProxyUrlForTarget(targetUrl);

  if (proxyUrl) {
    try {
      return await fetchJsonThroughProxy(targetUrl, proxyUrl, {
        timeoutMs: BANGUMI_PROXY_TIMEOUT_MS,
        userAgent: 'IceTV',
      });
    } catch {
      return await fetchBangumiCalendarDirect(init);
    }
  }

  return await fetchBangumiCalendarDirect(init);
}

async function fetchBangumiCalendarDirect(
  init: BangumiFetchInit,
): Promise<unknown> {
  const response = await fetch(BANGUMI_CALENDAR_URL, init);

  if (!response.ok) {
    throw new Error(`获取 Bangumi 日历失败: ${response.status}`);
  }

  return await response.json();
}

function getCachedBangumiCalendarData(): BangumiCalendarData[] | undefined {
  if (!bangumiCalendarCache || bangumiCalendarCache.expiresAt <= Date.now()) {
    return undefined;
  }

  return bangumiCalendarCache.data;
}
