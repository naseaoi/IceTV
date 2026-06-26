'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';

interface VirtualizedSearchGridProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  overscanRows?: number;
}

type GridLayout = {
  columnCount: number;
  columnGap: number;
  rowGap: number;
  columnWidth: number;
  rowHeight: number;
};

function getGridLayout(containerWidth: number): GridLayout {
  const isDesktop = containerWidth >= 640;
  const columnGap = isDesktop ? 32 : 8;
  const rowGap = isDesktop ? 80 : 56;
  const minColumnWidth = isDesktop ? 176 : 0;
  const columnCount = isDesktop
    ? Math.max(
        1,
        Math.floor((containerWidth + columnGap) / (minColumnWidth + columnGap)),
      )
    : 3;
  const columnWidth =
    (containerWidth - columnGap * (columnCount - 1)) / columnCount;
  const rowHeight = Math.ceil(
    columnWidth * 1.5 + rowGap + (isDesktop ? 98 : 72),
  );

  return {
    columnCount,
    columnGap,
    rowGap,
    columnWidth,
    rowHeight,
  };
}

export function VirtualizedSearchGrid<T>({
  items,
  getKey,
  renderItem,
  overscanRows = 2,
}: VirtualizedSearchGridProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewport, setViewport] = useState({ height: 0, scrollY: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(container.getBoundingClientRect().width);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    window.addEventListener('resize', updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    let frameId: number | null = null;

    const updateViewport = () => {
      frameId = null;
      setViewport({
        height: window.innerHeight,
        scrollY: window.scrollY || document.documentElement.scrollTop || 0,
      });
    };

    const handleScroll = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(updateViewport);
    };

    updateViewport();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  const fallbackItems = useMemo(() => items.slice(0, 30), [items]);

  if (containerWidth <= 0) {
    return (
      <div
        ref={containerRef}
        className='grid grid-cols-3 justify-start gap-x-2 gap-y-14 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'
      >
        {fallbackItems.map((item) => (
          <div key={getKey(item)} className='w-full'>
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  }

  const layout = getGridLayout(containerWidth);
  const totalRows = Math.ceil(items.length / layout.columnCount);
  const totalHeight = Math.max(0, totalRows * layout.rowHeight - layout.rowGap);
  const containerTop = containerRef.current
    ? containerRef.current.getBoundingClientRect().top + viewport.scrollY
    : 0;
  const viewportStart = Math.max(0, viewport.scrollY - containerTop);
  const viewportEnd = viewportStart + viewport.height;
  const startRow = Math.max(
    0,
    Math.floor(viewportStart / layout.rowHeight) - overscanRows,
  );
  const endRow = Math.min(
    totalRows,
    Math.ceil(viewportEnd / layout.rowHeight) + overscanRows,
  );
  const startIndex = startRow * layout.columnCount;
  const endIndex = Math.min(items.length, endRow * layout.columnCount);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div ref={containerRef} className='relative w-full'>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item, offset) => {
          const itemIndex = startIndex + offset;
          const row = Math.floor(itemIndex / layout.columnCount);
          const column = itemIndex % layout.columnCount;
          const left = column * (layout.columnWidth + layout.columnGap);
          const top = row * layout.rowHeight;

          return (
            <div
              key={getKey(item)}
              className='absolute'
              style={{
                left,
                top,
                width: layout.columnWidth,
              }}
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
