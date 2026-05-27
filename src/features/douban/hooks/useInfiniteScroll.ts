import { type RefObject, useEffect, useRef } from 'react';

interface UseInfiniteScrollOptions {
  enabled: boolean;
  onLoadMore: () => void;
  threshold?: number;
}

export function useInfiniteScroll<T extends HTMLElement>({
  enabled,
  onLoadMore,
  threshold = 0.1,
}: UseInfiniteScrollOptions): RefObject<T | null> {
  const sentinelRef = useRef<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!enabled || !sentinelRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold },
    );

    observer.observe(sentinelRef.current);
    observerRef.current = observer;

    return () => {
      observerRef.current?.disconnect();
    };
  }, [enabled, onLoadMore, threshold]);

  return sentinelRef;
}
