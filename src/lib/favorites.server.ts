import { cookies } from 'next/headers';

import {
  clampFavoriteSkeletonCount,
  FAVORITE_ITEMS_COUNT_COOKIE,
  FAVORITE_PREVIEW_LIMIT,
} from '@/lib/favorites-count';

export async function getFavoriteSkeletonCount(limit = FAVORITE_PREVIEW_LIMIT) {
  const cookieStore = await cookies();
  return clampFavoriteSkeletonCount(
    Number(cookieStore.get(FAVORITE_ITEMS_COUNT_COOKIE)?.value || 0),
    limit,
  );
}
