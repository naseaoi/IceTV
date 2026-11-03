export const POSTER_GRID_BASE_CLASS =
  'grid grid-cols-3 justify-start gap-x-3 gap-y-6 xs:grid-cols-4 sm:gap-y-6';

// 桌面端列宽随容器自适应，避免固定列宽在宽屏右侧留白
export const POSTER_GRID_CLASS = `${POSTER_GRID_BASE_CLASS} sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))] sm:gap-x-5`;

export const POSTER_GRID_ROW_GAP = 24;
