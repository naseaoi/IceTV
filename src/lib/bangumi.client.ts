'use client';

export type { BangumiCalendarData } from './bangumi';
import type { BangumiCalendarData } from './bangumi';
import { normalizeBangumiCalendarData } from './bangumi-normalize';
import { readBangumiDataSource } from './bangumi-source';

const BANGUMI_CALENDAR_URL = 'https://api.bgm.tv/calendar';

interface BangumiCalendarClientOptions {
  timeoutMs?: number;
}

export async function GetBangumiCalendarData(
  options: BangumiCalendarClientOptions = {},
): Promise<BangumiCalendarData[]> {
  const source = readBangumiDataSource();

  if (source === 'direct') {
    return await fetchBangumiCalendarDirect(options);
  }

  return await fetchBangumiCalendarFromServer(options);
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
  const controller = new AbortController();
  const timeoutId = options.timeoutMs
    ? window.setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;

  try {
    const response = await fetch(BANGUMI_CALENDAR_URL, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Bangumi calendar: ${response.status}`);
    }

    return normalizeBangumiCalendarData(await response.json());
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}
