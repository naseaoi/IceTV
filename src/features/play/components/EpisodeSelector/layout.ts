// 详情骨架与真实组件共用的布局尺寸
export const INFO_COVER_CLASS = 'aspect-[2/3] w-24 xl:w-[6.5rem]';
export const INFO_RATING_TEXT_CLASS = 'text-[15px] font-semibold tabular-nums';
export const INFO_RATING_LINE_CLASS = 'flex h-5 min-w-0 items-center gap-1.5';

// 桌面详情页：头部 / 简介 / 选集三行，剩余高度在简介与选集间均分，各自不超过内容高度
export const DESKTOP_MAIN_GRID_CLASS =
  'grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,auto)_minmax(0,auto)] content-start overflow-hidden';
