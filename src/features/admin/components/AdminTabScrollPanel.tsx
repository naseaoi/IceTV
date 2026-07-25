'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { type AdminTabId } from '@/features/admin/lib/admin-tabs';
import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';

interface AdminTabScrollPanelProps {
  activeTab: AdminTabId;
  children: ReactNode;
}

export function AdminTabScrollPanel({
  activeTab,
  children,
}: AdminTabScrollPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  const syncFade = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    setHasTopFade(container.scrollTop > 4);
    setHasBottomFade(
      maxScrollTop > 4 && container.scrollTop < maxScrollTop - 4,
    );
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    container.scrollTop = 0;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(syncFade);
    observer?.observe(container);
    observer?.observe(content);
    const timer = window.setTimeout(syncFade, 0);
    window.addEventListener('resize', syncFade);
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('resize', syncFade);
    };
  }, [activeTab, syncFade]);

  const maskStyle = getVerticalScrollMaskStyle(hasTopFade, hasBottomFade);

  return (
    <div
      ref={containerRef}
      data-admin-tab-scroll-panel
      data-top-fade={hasTopFade}
      data-bottom-fade={hasBottomFade}
      className='min-h-0 min-w-0 p-4 sm:p-6 md:h-full md:overflow-auto'
      onScroll={syncFade}
      style={maskStyle}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
