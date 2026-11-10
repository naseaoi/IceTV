// ContinueCard 与其骨架共用的几何类，改尺寸只改这里
const CONTINUE_CARD_BASE_CLASS = 'flex shrink-0 gap-3';

// 横排滚动用固定宽度，网格页铺满所在格子
export const CONTINUE_CARD_CLASS = `${CONTINUE_CARD_BASE_CLASS} w-[236px] md:w-[256px]`;

export const CONTINUE_CARD_FLUID_CLASS = `${CONTINUE_CARD_BASE_CLASS} w-full`;

export const CONTINUE_CARD_COVER_CLASS =
  'aspect-[2/3] w-[76px] shrink-0 self-start rounded-lg md:w-[88px]';

export const CONTINUE_CARD_COVER_SIZES = '(min-width: 768px) 88px, 76px';

export const CONTINUE_CARD_BODY_CLASS = 'flex min-w-0 flex-1 flex-col py-1';

export const CONTINUE_CARD_TITLE_TEXT_CLASS =
  'text-[13px] leading-snug md:text-sm';

export const CONTINUE_CARD_META_CLASS = 'mt-1 space-y-0.5 text-xs';

export const CONTINUE_CARD_FOOTER_CLASS = 'mt-auto pt-2';

export const CONTINUE_CARD_PROGRESS_TEXT_CLASS = 'text-[11px]';

export const CONTINUE_CARD_PROGRESS_BAR_CLASS = 'mt-1 h-1 rounded-full';
