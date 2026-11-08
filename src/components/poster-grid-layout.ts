export const POSTER_GRID_BASE_CLASS =
  'grid grid-cols-3 justify-start gap-x-3 gap-y-6 xs:grid-cols-4 sm:gap-y-6';

// 桌面端列宽随容器自适应，避免固定列宽在宽屏右侧留白
export const POSTER_GRID_CLASS = `${POSTER_GRID_BASE_CLASS} sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))] sm:gap-x-5`;

export const POSTER_GRID_ROW_GAP = 24;

// 标题行 mt-2 + 13px 行高；副标题行 mt-0.5 + text-xs 行高，与 poster-card-layout 的行类对应
const POSTER_TITLE_ROW_HEIGHT = 28;
const POSTER_SUBTITLE_ROW_HEIGHT = 18;

export const POSTER_VIRTUAL_GRID_LAYOUT = {
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 4,
  mobileColumnGap: 12,
  mobileRowGap: POSTER_GRID_ROW_GAP,
  mobileContentHeight: POSTER_TITLE_ROW_HEIGHT,
  desktopColumnGap: 20,
  desktopRowGap: POSTER_GRID_ROW_GAP,
  desktopMinColumnWidth: 156,
  desktopContentHeight: POSTER_TITLE_ROW_HEIGHT,
};

export const POSTER_VIRTUAL_GRID_WITH_SUBTITLE_LAYOUT = {
  ...POSTER_VIRTUAL_GRID_LAYOUT,
  mobileContentHeight: POSTER_TITLE_ROW_HEIGHT + POSTER_SUBTITLE_ROW_HEIGHT,
  desktopContentHeight: POSTER_TITLE_ROW_HEIGHT + POSTER_SUBTITLE_ROW_HEIGHT,
};
