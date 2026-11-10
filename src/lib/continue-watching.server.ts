import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { getPublicConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';
import { normalizePlayRecordLimit } from '@/lib/play-records';
import type { PlayRecord } from '@/lib/types';

const MAX_CONTINUE_WATCHING_SKELETON_COUNT = 8;

export async function getContinueWatchingSkeletonCount({
  cookieName = 'cw_count',
  limit = MAX_CONTINUE_WATCHING_SKELETON_COUNT,
}: { cookieName?: 'cw_count' | 'cw_page_count'; limit?: number } = {}) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth')?.value;
  if (!authCookie) {
    return 0;
  }

  const session = await getServerAuthSession(authCookie);
  if (session.status !== 'authenticated') {
    return 0;
  }

  return getListSkeletonCount(cookieName, limit);
}

export interface ContinueWatchingPageData {
  skeletonCount: number;
  counts: {
    all: number | null;
    updated: number | null;
    shelved: number | null;
  };
}

// 继续观看页首屏：骨架条数取计数 cookie，筛选胶囊的计数查库
export async function getContinueWatchingPageData(
  skeletonLimit: number,
): Promise<ContinueWatchingPageData> {
  const empty = {
    skeletonCount: 0,
    counts: { all: null, updated: null, shelved: null },
  };
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth')?.value;
  if (!authCookie) return empty;

  const session = await getServerAuthSession(authCookie);
  if (session.status !== 'authenticated') return empty;

  const skeletonCount = await getListSkeletonCount(
    'cw_page_count',
    skeletonLimit,
  );
  try {
    const [page, trackingPage, shelvedPage] = await Promise.all([
      db.getPlayRecordPage(session.username, 1),
      db.getUnreadTrackingPlayRecordPage(session.username, 1),
      db.getPlayRecordPage(
        session.username,
        1,
        undefined,
        undefined,
        'shelved',
      ),
    ]);
    return {
      skeletonCount,
      counts: {
        all: page.total,
        updated: trackingPage.total,
        shelved: shelvedPage.total,
      },
    };
  } catch (error) {
    console.error('获取继续观看计数失败:', error);
    return {
      skeletonCount,
      counts: { all: null, updated: null, shelved: null },
    };
  }
}

export interface ContinueWatchingInitialData {
  records: Record<string, PlayRecord> | null;
  updateCount: number;
}

export async function getContinueWatchingInitialData(): Promise<ContinueWatchingInitialData> {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth')?.value;
  if (!authCookie) {
    return { records: null, updateCount: 0 };
  }

  const session = await getServerAuthSession(authCookie);
  if (session.status !== 'authenticated') {
    return { records: null, updateCount: 0 };
  }

  try {
    const publicConfig = await getPublicConfig();
    const limit = normalizePlayRecordLimit(publicConfig.ContinueWatchingLimit);
    const [page, trackingPage] = await Promise.all([
      db.getPlayRecordPage(session.username, limit),
      db.getUnreadTrackingPlayRecordPage(session.username, 1),
    ]);
    return { records: page.items, updateCount: trackingPage.total };
  } catch (error) {
    console.error('获取继续观看首屏数据失败:', error);
    return { records: null, updateCount: 0 };
  }
}
