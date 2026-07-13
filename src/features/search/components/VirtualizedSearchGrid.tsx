'use client';

import { ReactNode } from 'react';

import {
  type VirtualizedGridLayoutConfig,
  VirtualizedGrid,
} from '@/components/VirtualizedGrid';

interface VirtualizedSearchGridProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  layout?: VirtualizedGridLayoutConfig;
  overscanRows?: number;
}

const SEARCH_GRID_FALLBACK_CLASS =
  'grid grid-cols-3 justify-start gap-x-3 gap-y-6 px-0 min-[480px]:grid-cols-4 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-14 sm:px-2';

const SEARCH_GRID_LAYOUT = {
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 4,
  mobileColumnGap: 12,
  mobileRowGap: 24,
  mobileContentHeight: 52,
  desktopColumnGap: 32,
  desktopRowGap: 56,
  desktopMinColumnWidth: 176,
  desktopContentHeight: 52,
};

export function VirtualizedSearchGrid<T>({
  items,
  getKey,
  renderItem,
  layout,
  overscanRows = 2,
}: VirtualizedSearchGridProps<T>) {
  return (
    <VirtualizedGrid
      items={items}
      getKey={getKey}
      renderItem={renderItem}
      layout={{ ...SEARCH_GRID_LAYOUT, ...layout }}
      overscanRows={overscanRows}
      fallbackClassName={SEARCH_GRID_FALLBACK_CLASS}
      fallbackItemClassName='w-full'
    />
  );
}
