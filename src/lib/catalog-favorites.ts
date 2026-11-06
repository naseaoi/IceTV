import type { Favorite } from '@/lib/types';

export function isCatalogFavoriteSource(source: string): boolean {
  return source === 'douban' || source === 'bangumi';
}

export function isFavoriteWatchStatus(
  value: unknown,
): value is NonNullable<Favorite['watch_status']> {
  return value === 'planned' || value === 'watching' || value === 'completed';
}

export function isWatchedAt(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8640000000000000
  );
}

export function normalizeFavoriteWatchFields(input: {
  watch_status?: unknown;
  watched_at?: unknown;
}): Pick<Favorite, 'watch_status' | 'watched_at'> {
  return {
    ...(isFavoriteWatchStatus(input.watch_status)
      ? { watch_status: input.watch_status }
      : {}),
    ...(input.watch_status === 'completed' && isWatchedAt(input.watched_at)
      ? { watched_at: input.watched_at }
      : {}),
  };
}
