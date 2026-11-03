'use client';

import { ReactNode } from 'react';

import {
  POSTER_GRID_CLASS,
  POSTER_VIRTUAL_GRID_LAYOUT,
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
      layout={{ ...POSTER_VIRTUAL_GRID_LAYOUT, ...layout }}
      overscanRows={overscanRows}
      fallbackClassName={POSTER_GRID_CLASS}
      fallbackItemClassName='w-full'
    />
  );
}
