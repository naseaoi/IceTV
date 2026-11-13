import {
  type LucideIcon,
  Armchair,
  Projector,
  Sofa,
  Ticket,
} from 'lucide-react';

import { type WatchLevel, watchLevelName } from '@/lib/watch-level';

export const WATCH_LEVEL_ICON: Record<WatchLevel, LucideIcon> = {
  1: Ticket,
  2: Armchair,
  3: Armchair,
  4: Armchair,
  5: Sofa,
  6: Projector,
};

export const WATCH_LEVEL_TONE_CLASS: Record<WatchLevel, string> = {
  1: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  2: 'bg-gray-200/80 text-gray-600 dark:bg-gray-700/80 dark:text-gray-300',
  3: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  4: 'bg-brand-100 text-brand-800 dark:bg-brand-500/25 dark:text-brand-200',
  5: 'bg-brand-500 text-white dark:bg-brand-500',
  6: 'bg-gradient-to-r from-gray-900 to-brand-800 text-brand-100 dark:from-brand-950 dark:to-brand-700 dark:text-brand-100',
};

export const WATCH_LEVEL_BADGE_SIZE = {
  sm: 'h-4 gap-0.5 pl-1.5 pr-1.5 text-[10px] [--stub-notch:2px]',
  md: 'h-5 gap-1 px-2 text-[11px] [--stub-notch:2.5px]',
} as const;

export default function WatchLevelBadge({
  level,
  size = 'sm',
}: {
  level: WatchLevel | undefined;
  size?: keyof typeof WATCH_LEVEL_BADGE_SIZE;
}) {
  if (!level) return null;
  const Icon = WATCH_LEVEL_ICON[level];
  const name = watchLevelName(level);
  return (
    <span
      title={`观影等级 ${level} · ${name}`}
      className={`ticket-stub inline-flex shrink-0 items-center font-medium leading-none ${WATCH_LEVEL_BADGE_SIZE[size]} ${WATCH_LEVEL_TONE_CLASS[level]}`}
    >
      <Icon
        aria-hidden='true'
        className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'}
        strokeWidth={2.25}
      />
      <span className='sr-only'>观影等级 {level} </span>
      {/* 小字号下中文字形在行框内偏上约 0.08em，下移后与图标、牌面上下居中 */}
      <span className='relative top-[0.08em]'>{name}</span>
    </span>
  );
}
