import { PAGE_CONTAINER_CLASS } from '@/components/page-container';

// 搜索页与其骨架共用的容器几何类

export const SEARCH_STICKY_BAR_CLASS =
  'border-b border-gray-200/70 bg-gray-50/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/80';

export const SEARCH_MOBILE_BAR_CLASS = `sticky top-0 z-30 md:top-16 lg:hidden ${SEARCH_STICKY_BAR_CLASS}`;

export const SEARCH_MOBILE_BAR_ROW_CLASS = `${PAGE_CONTAINER_CLASS} flex items-center py-2.5`;

export const SEARCH_CANCEL_BUTTON_CLASS =
  '-mr-1 shrink-0 pl-3 pr-1 text-[15px] text-gray-700 dark:text-gray-200 md:hidden';

export const SEARCH_MOBILE_FILTER_ROW_CLASS = `${PAGE_CONTAINER_CLASS} pb-2.5 sm:hidden`;

export const SEARCH_DESKTOP_BAR_CLASS = `hidden sm:block lg:sticky lg:top-16 lg:z-30 ${SEARCH_STICKY_BAR_CLASS}`;

export const SEARCH_DESKTOP_BAR_ROW_CLASS = `${PAGE_CONTAINER_CLASS} flex min-h-[60px] items-center gap-4 py-3`;

export const SEARCH_RESULTS_CONTAINER_CLASS = `${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-6`;

export const SEARCH_HISTORY_CONTAINER_CLASS = `${PAGE_CONTAINER_CLASS} pb-8 pt-5 md:pt-8`;

export const SEARCH_HISTORY_HEADER_CLASS =
  'mb-3 flex items-center justify-between';

export const SEARCH_HISTORY_TITLE_TEXT_CLASS = 'text-[15px]';

export const SEARCH_HISTORY_HEADER_BUTTON_SHAPE_CLASS =
  'rounded-full px-2.5 py-1 text-[13px]';

export const SEARCH_HISTORY_CHIP_SHAPE_CLASS = 'rounded-full px-4 py-2 text-sm';
