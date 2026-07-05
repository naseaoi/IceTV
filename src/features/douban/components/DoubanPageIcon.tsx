'use client';

import { Cat, Clover, Film, LayoutGrid, Tv } from 'lucide-react';

import type { DoubanType } from '@/features/douban/lib/pageMeta';

interface DoubanPageIconProps {
  type: DoubanType;
  className?: string;
}

const iconToneByType: Record<string, string> = {
  movie: 'text-blue-500',
  tv: 'text-emerald-500',
  anime: 'text-pink-500',
  show: 'text-violet-500',
  custom: 'text-amber-500',
};

export function DoubanPageIcon({ type, className }: DoubanPageIconProps) {
  const iconClassName = [
    className,
    iconToneByType[type] ?? 'text-slate-500 dark:text-slate-400',
  ]
    .filter(Boolean)
    .join(' ');

  switch (type) {
    case 'movie':
      return <Film className={iconClassName} />;
    case 'tv':
      return <Tv className={iconClassName} />;
    case 'anime':
      return <Cat className={iconClassName} />;
    case 'show':
      return <Clover className={iconClassName} />;
    default:
      return <LayoutGrid className={iconClassName} />;
  }
}
