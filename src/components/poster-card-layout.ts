// 海报卡几何类：真实卡片与骨架共用，骨架行高由同一字号行高撑出

export const HOME_POSTER_CARD_CLASS =
  'home-poster-card w-[25vw] min-w-[25vw] sm:w-40 sm:min-w-[160px]';

export const POSTER_CARD_COVER_CLASS = 'aspect-[2/3] rounded-lg';

// VideoCard、历史与排行卡片的标题行，高度取自然行高
export const POSTER_CARD_TITLE_ROW_CLASS = 'mt-2 text-[13px]';

// PosterCard 标题行固定 h-5
export const POSTER_CARD_FIXED_TITLE_ROW_CLASS = 'mt-2 h-5 text-[13px]';

export const POSTER_CARD_SUBTITLE_ROW_CLASS = 'mt-0.5 text-xs';

// 覆盖在海报上的徽标统一用深色实底，彩色只留给需要处理的状态
export const POSTER_BADGE_CLASS =
  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums shadow-sm sm:text-xs';

export const POSTER_BADGE_NEUTRAL_CLASS = `${POSTER_BADGE_CLASS} bg-black/70 text-white`;

// 海报悬停：整卡上浮，底部渐变压暗，与按压回弹共用一组过渡
export const POSTER_CARD_INTERACTION_CLASS =
  'group relative w-full cursor-pointer rounded-lg bg-transparent transition-[transform,opacity] duration-200 ease-out hover:z-10 sm:hover:-translate-y-1 active:scale-[0.98] active:opacity-80';

export const POSTER_HOVER_SHADE_CLASS =
  'pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-200 sm:group-hover:opacity-100';
