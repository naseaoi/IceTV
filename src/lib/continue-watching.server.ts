import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { getPublicConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { normalizePlayRecordLimit } from '@/lib/play-records';
import type { PlayRecord } from '@/lib/types';

const MAX_CONTINUE_WATCHING_SKELETON_COUNT = 8;

export async function getContinueWatchingSkeletonCount() {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth')?.value;
  if (!authCookie) {
    return 0;
  }

  const session = await getServerAuthSession(authCookie);
  if (session.status !== 'authenticated') {
    return 0;
  }

  const rawCount = Number(cookieStore.get('cw_count')?.value || 0);

  if (!Number.isFinite(rawCount) || rawCount <= 0) {
    return 0;
  }

  return Math.min(Math.floor(rawCount), MAX_CONTINUE_WATCHING_SKELETON_COUNT);
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
