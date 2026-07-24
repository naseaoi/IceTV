import {
  type RefCallback,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

interface UseInfiniteScrollOptions {
  enabled: boolean;
  onLoadMore: () => void;
  threshold?: number;
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

export function useInfiniteScroll<T extends HTMLElement>({
  enabled,
  onLoadMore,
  threshold = 0.1,
}: UseInfiniteScrollOptions): RefCallback<T> {
  const [sentinelElement, setSentinelElement] = useState<T | null>(null);
  const triggeredRef = useRef(false);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  const setSentinelRef = useCallback((node: T | null) => {
    setSentinelElement(node);
  }, []);

  useEffect(() => {
    if (!enabled) {
      triggeredRef.current = false;
      return;
    }

    triggeredRef.current = false;
    let frameId: number | null = null;
    const sentinel = sentinelElement;

    const triggerLoadMore = () => {
      if (triggeredRef.current) {
        return;
      }

      triggeredRef.current = true;
      onLoadMoreRef.current();
    };

    const readSentinel = () => {
      const viewportHeight = window.innerHeight;
      const margin = viewportHeight * threshold;
      const scrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
      const scrollTop = getScrollTop();

      if (scrollTop + viewportHeight >= scrollHeight - margin) {
        triggerLoadMore();
        return;
      }

      if (!sentinel) {
        return;
      }

      const rect = sentinel.getBoundingClientRect();

      if (rect.top <= viewportHeight + margin && rect.bottom >= -margin) {
        triggerLoadMore();
      }
    };

    const checkSentinel = () => {
      frameId = null;
      readSentinel();
    };

    const scheduleCheck = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(checkSentinel);
    };

    const intersectionObserver =
      sentinel && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries[0].isIntersecting) {
                triggerLoadMore();
              }
            },
            { threshold },
          )
        : null;

    if (sentinel) {
      intersectionObserver?.observe(sentinel);
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleCheck);

    resizeObserver?.observe(document.documentElement);
    resizeObserver?.observe(document.body);
    if (sentinel) {
      resizeObserver?.observe(sentinel);
    }

    document.addEventListener('scroll', scheduleCheck, {
      capture: true,
      passive: true,
    });
    window.addEventListener('scroll', scheduleCheck, {
      passive: true,
    });
    window.addEventListener('resize', scheduleCheck);
    scheduleCheck();

    return () => {
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener('scroll', scheduleCheck, true);
      window.removeEventListener('scroll', scheduleCheck);
      window.removeEventListener('resize', scheduleCheck);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [enabled, sentinelElement, threshold]);

  return setSentinelRef;
}
