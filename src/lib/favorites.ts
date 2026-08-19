export const DEFAULT_FAVORITE_PAGE_LIMIT = 24;
export const MAX_FAVORITE_PAGE_LIMIT = 100;

export interface FavoriteCursor {
  time: number;
  key: string;
}

export function normalizeFavoriteLimit(
  value: unknown,
  fallback = DEFAULT_FAVORITE_PAGE_LIMIT,
): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_FAVORITE_PAGE_LIMIT, Math.max(1, Math.floor(parsed)));
}

export function parseFavoriteCursor(
  cursor?: string | null,
): FavoriteCursor | null {
  if (!cursor) return null;

  const separatorIndex = cursor.indexOf('|');
  const time = Number.parseInt(cursor.slice(0, separatorIndex), 10);
  const key = separatorIndex >= 0 ? cursor.slice(separatorIndex + 1) : '';
  return Number.isFinite(time) && key ? { time, key } : null;
}
