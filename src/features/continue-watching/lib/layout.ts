export const CONTINUE_WATCHING_PAGE_SIZE = 24;

// 列宽下限对齐首页横排卡片，宽屏按可用宽度增列，避免卡片中段大片留白
export const CONTINUE_WATCHING_GRID_CLASS =
  'grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(256px,1fr))] sm:gap-y-6';

export type ContinueWatchingFilter = 'all' | 'updated' | 'shelved';

export function parseContinueWatchingFilter(
  value: string | string[] | null | undefined,
): ContinueWatchingFilter {
  return value === 'updated' || value === 'shelved' ? value : 'all';
}

export type ContinueWatchingView = 'grid' | 'calendar';

export function parseContinueWatchingView(
  value: string | string[] | null | undefined,
): ContinueWatchingView {
  return value === 'calendar' ? 'calendar' : 'grid';
}
