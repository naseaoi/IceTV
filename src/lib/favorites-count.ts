export const FAVORITE_ITEMS_COUNT_COOKIE = 'fav_count';
export const FAVORITE_PREVIEW_LIMIT = 20;
export const FAVORITE_RENDER_CHUNK = 48;

export function clampFavoriteSkeletonCount(count: number, limit: number) {
  return Number.isFinite(count)
    ? Math.min(Math.max(0, Math.floor(count)), limit)
    : 0;
}
