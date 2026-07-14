import {
  POSTER_GRID_BASE_CLASS,
  POSTER_GRID_ROW_GAP,
} from '@/components/poster-grid-layout';

export const DOUBAN_GRID_WRAPPER_CLASS = 'px-0';

export const DOUBAN_GRID_CLASS = `${POSTER_GRID_BASE_CLASS} sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-7`;

export const DOUBAN_GRID_ITEM_CLASS = 'w-full sm:w-[180px]';

export const DOUBAN_GRID_LAYOUT = {
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 4,
  mobileColumnGap: 12,
  mobileRowGap: POSTER_GRID_ROW_GAP,
  mobileItemWidth: 0,
  mobileContentHeight: 28,
  desktopColumnGap: 28,
  desktopRowGap: POSTER_GRID_ROW_GAP,
  desktopMinColumnWidth: 180,
  desktopItemWidth: 180,
  desktopContentHeight: 28,
};
