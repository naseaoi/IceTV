'use client';

export type { BangumiCalendarData } from './bangumi';
import {
  BANGUMI_CALENDAR_FRESH_SECONDS,
  BANGUMI_CALENDAR_MAX_AGE_SECONDS,
} from '@/features/home/lib/home-cache';
import {
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';

import type { BangumiCalendarData } from './bangumi';
import {
  isUsableBangumiCalendarData,
  normalizeBangumiCalendarData,
} from './bangumi-normalize';

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

export interface BangumiCalendarClientResult {
  data: BangumiCalendarData[];
  usedStaleFallback: boolean;
}

export async function GetBangumiCalendarData(
  options: BangumiCalendarClientOptions = {},
): Promise<BangumiCalendarData[]> {
  const result = await GetBangumiCalendarDataWithMeta(options);
  return result.data;
}

export async function GetBangumiCalendarDataWithMeta(
  options: BangumiCalendarClientOptions = {},
): Promise<BangumiCalendarClientResult> {
  const cachedData = readBangumiCalendarClientCache();
  if (cachedData) {
    return {
      data: cachedData,
      usedStaleFallback: false,
    };
  }

  const staleData = readBangumiCalendarClientCache({ allowStale: true });
  let data: BangumiCalendarData[];

  try {
    data = await fetchBangumiCalendarPreferServer(options);
  } catch (error) {
    if (staleData) {
      return {
        data: staleData,
        usedStaleFallback: true,
      };
    }
    throw error;
  }

  if (isUsableBangumiCalendarData(data)) {
    writeBangumiCalendarClientCache(data);
    return {
      data,
      usedStaleFallback: false,
    };
  }

  return {
    data: staleData ?? data,
    usedStaleFallback: false,
  };
}

// 日历全站一份，服务端共享缓存命中最快；服务端回源不通时浏览器直连兜底
async function fetchBangumiCalendarPreferServer(
  options: BangumiCalendarClientOptions,
): Promise<BangumiCalendarData[]> {
  try {
    const data = await fetchBangumiCalendarFromServer(options);
    if (isUsableBangumiCalendarData(data)) return data;
  } catch {
    // 交给直连
  }
  return fetchBangumiCalendarDirect(options);
}

async function fetchBangumiCalendarFromServer(
  options: BangumiCalendarClientOptions,
): Promise<BangumiCalendarData[]> {
  const params = new URLSearchParams();
  if (options.timeoutMs) {
    params.set('timeoutMs', options.timeoutMs.toString());
  }
  const query = params.toString();

  const response = await fetch(
    `/api/bangumi/calendar${query ? `?${query}` : ''}`,
  );

  if (!response.ok) {
    throw new Error(`Bangumi calendar: ${response.status}`);
  }

  return normalizeBangumiCalendarData(await response.json());
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
    const rawCache = readStorage(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
    if (!rawCache) {
      return null;
    }

    const cache = JSON.parse(rawCache) as BangumiCalendarClientCache;
    const now = Date.now();
    if (!Number.isFinite(cache.staleUntil) || cache.staleUntil <= now) {
      removeStorage(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
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
      removeStorage(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
      return null;
    }

    return data;
  } catch {
    removeStorage(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
    return null;
  }
}

function writeBangumiCalendarClientCache(data: BangumiCalendarData[]): void {
  if (typeof window === 'undefined' || !isUsableBangumiCalendarData(data)) {
    return;
  }

  const now = Date.now();
  const written = writeStorage(
    BANGUMI_CALENDAR_CACHE_STORAGE_KEY,
    JSON.stringify({
      data,
      freshUntil: now + BANGUMI_CALENDAR_FRESH_MS,
      staleUntil: now + BANGUMI_CALENDAR_MAX_AGE_MS,
    }),
  );
  if (!written) {
    removeStorage(BANGUMI_CALENDAR_CACHE_STORAGE_KEY);
  }
}
