'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { noSelectStyle, preventContextMenu } from './constants';

interface VideoCardTitleProps {
  title: string;
}

interface TooltipAnchor {
  anchorX: number;
  top: number;
}

interface TooltipLayout {
  left: number;
  arrowLeft: number;
}

const TOOLTIP_VIEWPORT_MARGIN = 8;
const TOOLTIP_SHOW_DELAY_MS = 100;

export function VideoCardTitle({ title }: VideoCardTitleProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [layout, setLayout] = useState<TooltipLayout | null>(null);

  // 完整标题渲染到 body 上的 portal，先测量宽度再夹紧到视口内，避免被卡片或横向滚动容器裁剪
  useLayoutEffect(() => {
    if (!anchor || !tooltipRef.current) {
      return;
    }

    const width = tooltipRef.current.offsetWidth;
    const maxLeft = window.innerWidth - TOOLTIP_VIEWPORT_MARGIN - width;
    const left = Math.max(
      TOOLTIP_VIEWPORT_MARGIN,
      Math.min(anchor.anchorX - width / 2, maxLeft),
    );
    const arrowLeft = Math.min(
      Math.max(anchor.anchorX - left, 12),
      Math.max(12, width - 12),
    );
    setLayout({ left, arrowLeft });
  }, [anchor]);

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  const showTooltip = (event: React.MouseEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextAnchor: TooltipAnchor = {
      anchorX: rect.left + rect.width / 2,
      top: rect.top,
    };

    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
    }
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      setAnchor(nextAnchor);
    }, TOOLTIP_SHOW_DELAY_MS);
  };

  const hideTooltip = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setAnchor(null);
    setLayout(null);
  };

  return (
    <div
      data-video-card-title
      className='mt-2 text-center'
      style={noSelectStyle}
      onContextMenu={preventContextMenu}
    >
      <span
        className='block truncate text-sm font-semibold text-gray-900 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:text-gray-100 dark:group-hover:text-green-400'
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        {title}
      </span>
      {anchor &&
        createPortal(
          <div
            ref={tooltipRef}
            className='pointer-events-none fixed z-[1000] w-max max-w-[calc(100vw-16px)] -translate-y-full break-words rounded-md bg-gray-800 px-3 py-1 text-xs text-white shadow-lg'
            style={{
              top: anchor.top - 8,
              left: layout ? layout.left : anchor.anchorX,
              visibility: layout ? 'visible' : 'hidden',
              ...noSelectStyle,
            }}
          >
            {title}
            <div
              className='absolute top-full h-0 w-0 -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
              style={{ left: layout ? layout.arrowLeft : '50%' }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
