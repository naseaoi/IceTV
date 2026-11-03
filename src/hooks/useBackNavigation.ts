'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import {
  getBackFallbackPath,
  normalizeInternalReturnPath,
  PLAYER_EXIT_EVENT,
  RETURN_TO_PARAM,
} from '@/lib/navigation-return';

// Navigation API 的历史条目只含与当前页连续的同源记录，canGoBack 为真即上一页仍在站内
function canGoBackInApp(): boolean {
  const navigation = (
    window as Window & { navigation?: { canGoBack?: boolean } }
  ).navigation;
  return navigation?.canGoBack === true;
}

// 优先回到 returnTo 指定的来源；否则有站内上一页时退回，直接打开时才替换到回退页
export function useBackNavigation(fallbackHref?: string) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();

  return useCallback(() => {
    const returnTo = new URLSearchParams(window.location.search).get(
      RETURN_TO_PARAM,
    );
    if (pathname.startsWith('/play')) {
      window.dispatchEvent(new Event(PLAYER_EXIT_EVENT));
    }
    if (!returnTo && canGoBackInApp()) {
      router.back();
      return;
    }
    const fallback = normalizeInternalReturnPath(
      fallbackHref,
      getBackFallbackPath(pathname),
    );
    router.replace(normalizeInternalReturnPath(returnTo, fallback));
  }, [fallbackHref, pathname, router]);
}
