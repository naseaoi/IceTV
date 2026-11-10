import { FAVORITE_PREVIEW_LIMIT } from '@/lib/favorites-count';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export function getFavoriteSkeletonCount(limit = FAVORITE_PREVIEW_LIMIT) {
  return getListSkeletonCount('fav_count', limit);
}
