'use client';

export type { BangumiCalendarData } from './bangumi';
import type { BangumiCalendarData } from './bangumi';
import {
  BANGUMI_CALENDAR_FRESH_SECONDS,
  BANGUMI_CALENDAR_MAX_AGE_SECONDS,
} from '@/features/home/lib/home-cache';
import { normalizeBangumiCalendarData } from './bangumi-normalize';
import {
  readBangumiDataSource,
  readBangumiProxyUrl,
} from '@/lib/bangumi-source';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';

const BANGUMI_CALENDAR_URL = 'https://api.bgm.tv/calendar';
const BANGUMI_CALENDAR_CACHE_STORAGE_KEY = 'bangumiCalendarCache';
const BANGUMI_CALENDAR_FRESH_MS = BANGUMI_CALENDAR_FRESH_SECONDS * 1000;
const BANGUMI_CALENDAR_MAX_AGE_MS = BANGUMI_CALENDAR_MAX_AGE_SECONDS * 1000;

interface BangumiCalendarClientOptions {
  timeoutMs?: number;
}

interface BangumiCalendarClientCache {
  data: unknown;
  freshUntil: number;
  staleUntil: number;
}

export async function GetBangumiCalendarData(
  options: BangumiCalendarClientOptions = {},
): Promise<BangumiCalendarData[]> {
  const cachedData = readBangumiCalendarClientCache();
  if (cachedData) {
    return cachedData;
  }

  const staleData = readBangumiCalendarClientCache({ allowStale: true });
  const source = getUsableBangumiDataSource(readBangumiDataSource());
  let data: BangumiCalendarData[];

  try {
    if (source === 'direct') {
      data = await fetchBangumiCalendarDirect(options);
    } else if (source === 'custom') {
      data = await fetchBangumiCalendarCustomProxy(options);
    } else {
      data = await fetchBangumiCalendarFromServer(options);
    }
  } catch (error) {
    if (staleData) {
      return staleData;
    }
    throw error;
  }

  if (isUsableBangumiCalendarData(data)) {
    writeBangumiCalendarClientCache(data);
    return data;
  }

  return staleData ?? data;
}

function getUsableBangumiDataSource(source: string): string {
  if (source !== 'server') {
    return source;
  }

  return getAuthInfoFromBrowserCookie()?.username ? source : 'direct';
}

async function fetchBangumiCalendarFromServer(
  options: BangumiCalendarClientOptions,
): Promise<BangumiCalendarData[]> {
  const params = new URLSearchParams({ source: 'server' });

  if (options.timeoutMs) {
    params.set('timeoutMs', options.timeoutMs.toString());
  }

  const response = await fetch(`/api/bangumi/calendar?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Bangumi calendar: ${response.status}`);
  }

  return (await response.json()) as BangumiCalendarData[];
}

async function fetchBangumiCalendarDirect(
  options: BangumiCalendarClientOptions,
): Promise<BangumiCalendarData[]> {
  const abortState = createOptionalAbortState(options.timeoutMs);

  try {
    const response = await fetch(BANGUMI_CALENDAR_URL, {
      cache: 'no-store',
      signal: abortState?.signal,
    });

    if (!response.ok) {
      throw new Error(`Bangumi calendar: ${response.status}`);
    }

    return normalizeBangumiCalendarData(await response.json());
  } finally {
    abortState?.cleanup();
  }
}

async function fetchBangumiCalendarCustomProxy(
  options: BangumiCalendarClientOptions,
): Promise<BangumiCalendarData[]> {
  const proxyUrl = readBangumiProxyUrl().trim();
  if (!proxyUrl) {
    throw new Error('Bangumi custom proxy URL is empty');
  }

  const abortState = createOptionalAbortState(options.timeoutMs);

  try {
    const response = await fetch(
      `${proxyUrl}${encodeURIComponent(BANGUMI_CALENDAR_URL)}`,
      {
        cache: 'no-store',
        signal: abortState?.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Bangumi calendar: ${response.status}`);
    }

    return normalizeBangumiCalendarData(await response.json());
  } finally {
    abortState?.cleanup();
  }
}

function createOptionalAbortState(timeoutMs: number | undefined) {
  return timeoutMs
    ? createTimedAbortController(undefined, timeoutMs)
    : undefined;
}

function readBangumiCalendarClientCache(
  options: {
    allowStale?: boolean;
  } = {},
): BangumiCalendarData[] | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawCache = window.localStorage.getItem(
      BANGUMI_CALENDAR_CACHE_STORAGE_KEY,
    );
    if (!rawCache) {
      return null;
    }

    const cache = JSON.parse(rawCache) as BangumiCalendarClientCache;
    const now = Date.now();
    if (!Number.isFinite(cache.staleUntil) || cache.staleUntil <= now) {
      window.localStorage.removeItem(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
      return null;
    }

    if (
      !options.allowStale &&
      (!Number.isFinite(cache.freshUntil) || cache.freshUntil <= now)
    ) {
      return null;
    }

    const data = normalizeBangumiCalendarData(cache.data);
    if (!isUsableBangumiCalendarData(data)) {
      window.localStorage.removeItem(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
      return null;
    }

    return data;
  } catch {
    window.localStorage.removeItem(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
    return null;
  }
}

function writeBangumiCalendarClientCache(data: BangumiCalendarData[]): void {
  if (typeof window === 'undefined' || !isUsableBangumiCalendarData(data)) {
    return;
  }

  const now = Date.now();
  try {
    window.localStorage.setItem(
      BANGUMI_CALENDAR_CACHE_STORAGE_KEY,
      JSON.stringify({
        data,
        freshUntil: now + BANGUMI_CALENDAR_FRESH_MS,
        staleUntil: now + BANGUMI_CALENDAR_MAX_AGE_MS,
      }),
    );
  } catch {
    window.localStorage.removeItem(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
  }
}

function isUsableBangumiCalendarData(data: BangumiCalendarData[]): boolean {
  return data.some((item) => item.items.length > 0);
}
