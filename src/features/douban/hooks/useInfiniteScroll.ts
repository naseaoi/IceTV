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
  const observerRef = useRef<IntersectionObserver | null>(null);
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
    let pollTimerId: number | null = null;
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

    const pollSentinel = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      readSentinel();
      pollTimerId = window.setTimeout(pollSentinel, 160);
    };

    if (sentinel) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            triggerLoadMore();
          }
        },
        { threshold },
      );

      observer.observe(sentinel);
      observerRef.current = observer;
    }
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
      target.addEventListener('scroll', scheduleCheck, { passive: true });
    });
    window.addEventListener('resize', scheduleCheck);
    scheduleCheck();
    pollTimerId = window.setTimeout(pollSentinel, 160);

    return () => {
      observerRef.current?.disconnect();
      scrollTargets.forEach((target) => {
        target.removeEventListener('scroll', scheduleCheck);
      });
      window.removeEventListener('resize', scheduleCheck);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId);
      }
    };
  }, [enabled, onLoadMore, sentinelElement, threshold]);

  return setSentinelRef;
}
