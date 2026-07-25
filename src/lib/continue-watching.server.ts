import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';

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
