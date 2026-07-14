'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ScrollableRowProps {
  children: React.ReactNode;
  scrollDistance?: number;
}

export default function ScrollableRow({
  children,
  scrollDistance = 1000,
}: ScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const scrollButtonStateRef = useRef({ left: false, right: false });

  const updateScrollButtonState = useCallback(
    (nextState: { left: boolean; right: boolean }) => {
      const currentState = scrollButtonStateRef.current;

      if (currentState.left !== nextState.left) {
        currentState.left = nextState.left;
        setShowLeftScroll(nextState.left);
      }

      if (currentState.right !== nextState.right) {
        currentState.right = nextState.right;
        setShowRightScroll(nextState.right);
      }
    },
    [],
  );

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const threshold = 1;
    updateScrollButtonState({
      left: scrollLeft > threshold,
      right: scrollWidth - (scrollLeft + clientWidth) > threshold,
    });
  }, [updateScrollButtonState]);

  const scheduleCheckScroll = useCallback(() => {
    if (typeof window.requestAnimationFrame !== 'function') {
      checkScroll();
      return;
    }

    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      checkScroll();
    });
  }, [checkScroll]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    checkScroll();

    const resizeObserver = new ResizeObserver(scheduleCheckScroll);
    resizeObserver.observe(el);

    const mutationObserver = new MutationObserver(scheduleCheckScroll);
    mutationObserver.observe(el, {
      childList: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [checkScroll, scheduleCheckScroll]);

  const handleScrollRightClick = () => {
    containerRef.current?.scrollBy({
      left: scrollDistance,
      behavior: 'smooth',
    });
  };

  const handleScrollLeftClick = () => {
    containerRef.current?.scrollBy({
      left: -scrollDistance,
      behavior: 'smooth',
    });
  };

  return (
    <div
      className='relative'
      onMouseEnter={() => {
        setIsHovered(true);
        scheduleCheckScroll();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={containerRef}
        className='scrollbar-hide flex space-x-3 overflow-x-auto py-1 pb-3 pl-1 pr-4 sm:space-x-7 sm:py-2 sm:pb-6 sm:pr-6'
        onScroll={scheduleCheckScroll}
      >
        {children}
      </div>
      {showLeftScroll && (
        <div
          className={`absolute bottom-0 left-0 top-0 z-[600] hidden w-16 items-center justify-center transition-opacity duration-200 sm:flex ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'transparent',
            pointerEvents: 'none',
          }}
        >
          <div
            className='absolute inset-0 flex items-center justify-center'
            style={{
              top: '40%',
              bottom: '60%',
              left: '-4.5rem',
              pointerEvents: 'auto',
            }}
          >
            <button
              type='button'
              aria-label='向左滚动'
              onClick={handleScrollLeftClick}
              className='flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white/95 shadow-lg transition-transform hover:scale-105 hover:bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:hover:bg-gray-700'
            >
              <ChevronLeft
                className='h-6 w-6 text-gray-600 dark:text-gray-300'
                aria-hidden='true'
              />
            </button>
          </div>
        </div>
      )}

      {showRightScroll && (
        <div
          className={`absolute bottom-0 right-0 top-0 z-[600] hidden w-16 items-center justify-center transition-opacity duration-200 sm:flex ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'transparent',
            pointerEvents: 'none',
          }}
        >
          <div
            className='absolute inset-0 flex items-center justify-center'
            style={{
              top: '40%',
              bottom: '60%',
              right: '-4.5rem',
              pointerEvents: 'auto',
            }}
          >
            <button
              type='button'
              aria-label='向右滚动'
              onClick={handleScrollRightClick}
              className='flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white/95 shadow-lg transition-transform hover:scale-105 hover:bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:hover:bg-gray-700'
            >
              <ChevronRight
                className='h-6 w-6 text-gray-600 dark:text-gray-300'
                aria-hidden='true'
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
