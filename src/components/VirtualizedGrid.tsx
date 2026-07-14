'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import {
  type VirtualizedGridLayoutConfig,
  getGridLayout,
} from '@/components/virtualized-grid/layout';

export type { VirtualizedGridLayoutConfig } from '@/components/virtualized-grid/layout';

interface VirtualizedGridProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  layout?: VirtualizedGridLayoutConfig;
  overscanRows?: number;
  fallbackCount?: number;
  fallbackClassName: string;
  fallbackItemClassName?: string;
}

function getScrollTop() {
  return (
    window.scrollY ||
    document.scrollingElement?.scrollTop ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

export function VirtualizedGrid<T>({
  items,
  getKey,
  renderItem,
  layout,
  overscanRows = 2,
  fallbackCount = 30,
  fallbackClassName,
  fallbackItemClassName = 'w-full',
}: VirtualizedGridProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewport, setViewport] = useState({
    width: 0,
    height: 0,
    scrollY: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameId: number | null = null;
    const updateWidth = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextWidth = container.getBoundingClientRect().width;
        setContainerWidth((currentWidth) =>
          currentWidth === nextWidth ? currentWidth : nextWidth,
        );
      });
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    window.addEventListener('resize', updateWidth);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    let frameId: number | null = null;

    const readViewport = () => {
      const nextViewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollY: getScrollTop(),
      };

      setViewport((currentViewport) => {
        if (
          currentViewport.width === nextViewport.width &&
          currentViewport.height === nextViewport.height &&
          currentViewport.scrollY === nextViewport.scrollY
        ) {
          return currentViewport;
        }

        return nextViewport;
      });
    };

    const updateViewport = () => {
      frameId = null;
      readViewport();
    };

    const handleScroll = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(updateViewport);
    };

    updateViewport();
    let pollTimerId: number | null = null;
    const pollViewport = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      readViewport();
      pollTimerId = window.setTimeout(pollViewport, 120);
    };

    pollTimerId = window.setTimeout(pollViewport, 120);

    const scrollTargets = new Set<EventTarget>([
      window,
      document,
      document.documentElement,
      document.body,
    ]);

    if (document.scrollingElement) {
      scrollTargets.add(document.scrollingElement);
    }

    scrollTargets.forEach((target) => {
      target.addEventListener('scroll', handleScroll, { passive: true });
    });
    window.addEventListener('resize', handleScroll);

    return () => {
      scrollTargets.forEach((target) => {
        target.removeEventListener('scroll', handleScroll);
      });
      window.removeEventListener('resize', handleScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId);
      }
    };
  }, []);

  const fallbackItems = useMemo(
    () => items.slice(0, fallbackCount),
    [fallbackCount, items],
  );

  if (containerWidth <= 0) {
    return (
      <div ref={containerRef} className={fallbackClassName}>
        {fallbackItems.map((item) => (
          <div key={getKey(item)} className={fallbackItemClassName}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  }

  const computedLayout = getGridLayout(
    containerWidth,
    viewport.width || window.innerWidth,
    layout,
  );
  const totalRows = Math.ceil(items.length / computedLayout.columnCount);
  const totalHeight = Math.max(
    0,
    totalRows * computedLayout.rowHeight - computedLayout.rowGap,
  );
  const containerTop = containerRef.current
    ? containerRef.current.getBoundingClientRect().top + viewport.scrollY
    : 0;
  const viewportStart = Math.max(0, viewport.scrollY - containerTop);
  const viewportEnd = viewportStart + viewport.height;
  const startRow = Math.max(
    0,
    Math.floor(viewportStart / computedLayout.rowHeight) - overscanRows,
  );
  const endRow = Math.min(
    totalRows,
    Math.ceil(viewportEnd / computedLayout.rowHeight) + overscanRows,
  );
  const startIndex = startRow * computedLayout.columnCount;
  const endIndex = Math.min(items.length, endRow * computedLayout.columnCount);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div ref={containerRef} className='relative w-full'>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item, offset) => {
          const itemIndex = startIndex + offset;
          const row = Math.floor(itemIndex / computedLayout.columnCount);
          const column = itemIndex % computedLayout.columnCount;
          const left =
            column * (computedLayout.trackWidth + computedLayout.columnGap);
          const top = row * computedLayout.rowHeight;

          return (
            <div
              key={getKey(item)}
              className='absolute'
              style={{
                left,
                top,
                width: computedLayout.itemWidth,
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
