import { cookies } from 'next/headers';

import { FAVORITE_ITEMS_COUNT_COOKIE } from '@/lib/favorites-count';

const MAX_FAVORITE_SKELETON_COUNT = 8;

export async function getFavoriteSkeletonCount() {
  const cookieStore = await cookies();
  const rawCount = Number(
    cookieStore.get(FAVORITE_ITEMS_COUNT_COOKIE)?.value || 0,
  );

  if (!Number.isFinite(rawCount) || rawCount <= 0) {
    return 0;
  }

  return Math.min(Math.floor(rawCount), MAX_FAVORITE_SKELETON_COUNT);
}
