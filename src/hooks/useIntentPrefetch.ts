'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';

export function useIntentPrefetch() {
  const router = useRouter();
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());

  return useCallback(
    (href: string) => {
      if (!href || prefetchedRoutesRef.current.has(href)) {
        return;
      }

      prefetchedRoutesRef.current.add(href);
      router.prefetch(href);
    },
    [router],
  );
}
