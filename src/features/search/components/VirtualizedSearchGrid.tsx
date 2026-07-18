'use client';

import { ReactNode } from 'react';

import {
  POSTER_GRID_BASE_CLASS,
  POSTER_GRID_ROW_GAP,
} from '@/components/poster-grid-layout';
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

const SEARCH_GRID_FALLBACK_CLASS = `${POSTER_GRID_BASE_CLASS} px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:px-2`;

const SEARCH_GRID_LAYOUT = {
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 4,
  mobileColumnGap: 12,
  mobileRowGap: POSTER_GRID_ROW_GAP,
  mobileContentHeight: 28,
  desktopColumnGap: 32,
  desktopRowGap: POSTER_GRID_ROW_GAP,
  desktopMinColumnWidth: 176,
  desktopContentHeight: 28,
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
