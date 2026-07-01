import { cookies } from 'next/headers';

const MAX_CONTINUE_WATCHING_SKELETON_COUNT = 8;

export async function getContinueWatchingSkeletonCount() {
  const cookieStore = await cookies();
  const rawCount = Number(cookieStore.get('cw_count')?.value || 0);

  if (!Number.isFinite(rawCount) || rawCount <= 0) {
    return 0;
  }

  return Math.min(Math.floor(rawCount), MAX_CONTINUE_WATCHING_SKELETON_COUNT);
}
