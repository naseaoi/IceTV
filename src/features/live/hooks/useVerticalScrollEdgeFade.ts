import type { CSSProperties, MutableRefObject, RefCallback } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';

interface UseVerticalScrollEdgeFadeOptions {
  externalRef?: MutableRefObject<HTMLDivElement | null>;
  refreshKey?: string | number;
}

interface VerticalScrollEdgeFadeState {
  ref: RefCallback<HTMLDivElement>;
  onScroll: () => void;
  style: CSSProperties | undefined;
  hasTopFade: boolean;
  hasBottomFade: boolean;
}

export function useVerticalScrollEdgeFade({
  externalRef,
  refreshKey,
}: UseVerticalScrollEdgeFadeOptions = {}): VerticalScrollEdgeFadeState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerElement, setContainerElement] =
    useState<HTMLDivElement | null>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  const setContainerRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      containerRef.current = element;
      setContainerElement(element);
      if (externalRef) externalRef.current = element;
    },
    [externalRef],
  );

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
    const container = containerElement;
    if (!container) return;

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(syncFade);
    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(syncFade);

    resizeObserver?.observe(container);
    mutationObserver?.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const timer = window.setTimeout(syncFade, 0);
    window.addEventListener('resize', syncFade);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('resize', syncFade);
    };
  }, [containerElement, refreshKey, syncFade]);

  return {
    ref: setContainerRef,
    onScroll: syncFade,
    style: getVerticalScrollMaskStyle(hasTopFade, hasBottomFade),
    hasTopFade,
    hasBottomFade,
  };
}
