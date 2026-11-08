'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useCallback } from 'react';

import { LIVE_ROUTE } from '@/components/channel-nav';
import { useIntentPrefetch } from '@/hooks/useIntentPrefetch';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';

// 直播页带上来源地址，退出直播时回到进入前的页面
export function useChannelNavigation() {
  const router = useRouter();
  const prefetchIntent = useIntentPrefetch();

  const prefetchRoute = useCallback(
    (href: string) => {
      if (href !== LIVE_ROUTE) prefetchIntent(href);
    },
    [prefetchIntent],
  );

  const handleNavClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        href !== LIVE_ROUTE ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const returnTo = getCurrentNavigationPath();
      if (returnTo.startsWith(LIVE_ROUTE)) return;

      event.preventDefault();
      router.push(withReturnTo(href, returnTo));
    },
    [router],
  );

  return { prefetchRoute, handleNavClick };
}
