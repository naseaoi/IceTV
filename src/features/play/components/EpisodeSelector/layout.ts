// 详情骨架与真实组件共用的布局尺寸
// 顶部对齐，避免右侧内容变高时把封面拉伸变形
export const INFO_COVER_CLASS = 'aspect-[2/3] w-24 self-start xl:w-[6.5rem]';
export const INFO_RATING_TEXT_CLASS = 'text-[15px] font-semibold tabular-nums';
// 星形图标框底留白约等于 1em 行高文字的基线下留白，底边对齐即星尖落在文字基线上
export const INFO_RATING_LINE_CLASS =
  'flex h-5 min-w-0 items-end gap-1.5 leading-none';

// 桌面详情页：头部 / 简介 / 选集三行，剩余高度在简介与选集间均分，各自不超过内容高度
export const DESKTOP_MAIN_GRID_CLASS =
  'grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,auto)_minmax(0,auto)] content-start overflow-hidden';
