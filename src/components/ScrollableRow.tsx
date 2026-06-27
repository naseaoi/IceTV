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

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const threshold = 1;
    setShowRightScroll(scrollWidth - (scrollLeft + clientWidth) > threshold);
    setShowLeftScroll(scrollLeft > threshold);
  }, []);

  // 单个 useEffect 统一管理所有 observer，不依赖 children
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    checkScroll();

    // ResizeObserver 监听容器尺寸变化（包括子元素导致的尺寸变化）
    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(el);

    // MutationObserver 监听子元素增删（覆盖 children 变化场景）
    const mutationObserver = new MutationObserver(checkScroll);
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [checkScroll]);

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
        checkScroll();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={containerRef}
        className='scrollbar-hide flex space-x-7 overflow-x-auto py-1 pb-12 pl-1 pr-4 sm:py-2 sm:pb-14 sm:pr-6'
        onScroll={checkScroll}
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
              onClick={handleScrollLeftClick}
              className='flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white/95 shadow-lg transition-transform hover:scale-105 hover:bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:hover:bg-gray-700'
            >
              <ChevronLeft className='h-6 w-6 text-gray-600 dark:text-gray-300' />
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
              onClick={handleScrollRightClick}
              className='flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white/95 shadow-lg transition-transform hover:scale-105 hover:bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:hover:bg-gray-700'
            >
              <ChevronRight className='h-6 w-6 text-gray-600 dark:text-gray-300' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
