'use client';

import { Cat, Clover, Film, LayoutGrid, Tv } from 'lucide-react';

import type { DoubanType } from '@/features/douban/lib/pageMeta';

interface DoubanPageIconProps {
  type: DoubanType;
  className?: string;
}

export function DoubanPageIcon({ type, className }: DoubanPageIconProps) {
  switch (type) {
    case 'movie':
      return <Film className={className} />;
    case 'tv':
      return <Tv className={className} />;
    case 'anime':
      return <Cat className={className} />;
    case 'show':
      return <Clover className={className} />;
    default:
      return <LayoutGrid className={className} />;
  }
}
