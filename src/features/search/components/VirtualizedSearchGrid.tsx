'use client';

import { ReactNode } from 'react';

import {
  POSTER_GRID_CLASS,
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

const SEARCH_GRID_LAYOUT = {
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 4,
  mobileColumnGap: 12,
  mobileRowGap: POSTER_GRID_ROW_GAP,
  mobileContentHeight: 28,
  desktopColumnGap: 20,
  desktopRowGap: POSTER_GRID_ROW_GAP,
  desktopMinColumnWidth: 156,
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
      fallbackClassName={POSTER_GRID_CLASS}
      fallbackItemClassName='w-full'
    />
  );
}
