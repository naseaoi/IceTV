'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import {
  getBackFallbackPath,
  normalizeInternalReturnPath,
  PLAYER_EXIT_EVENT,
  RETURN_TO_PARAM,
} from '@/lib/navigation-return';

export function useBackNavigation(fallbackHref?: string) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();

  return useCallback(() => {
    const fallback = normalizeInternalReturnPath(
      fallbackHref,
      getBackFallbackPath(pathname),
    );
    const returnTo = new URLSearchParams(window.location.search).get(
      RETURN_TO_PARAM,
    );
    if (pathname.startsWith('/play')) {
      window.dispatchEvent(new Event(PLAYER_EXIT_EVENT));
    }
    router.replace(normalizeInternalReturnPath(returnTo, fallback));
  }, [fallbackHref, pathname, router]);
}
