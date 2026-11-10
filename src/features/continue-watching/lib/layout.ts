export const CONTINUE_WATCHING_PAGE_SIZE = 24;

export const CONTINUE_WATCHING_GRID_CLASS =
  'grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 sm:gap-y-6 lg:grid-cols-3 2xl:grid-cols-4';

export type ContinueWatchingFilter = 'all' | 'updated' | 'shelved';

export function parseContinueWatchingFilter(
  value: string | string[] | null | undefined,
): ContinueWatchingFilter {
  return value === 'updated' || value === 'shelved' ? value : 'all';
}
