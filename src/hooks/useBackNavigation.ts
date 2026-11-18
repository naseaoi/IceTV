'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import {
  getBackFallbackPath,
  normalizeInternalReturnPath,
  PLAYER_EXIT_EVENT,
  RETURN_TO_PARAM,
} from '@/lib/navigation-return';

interface NavigationHistoryEntry {
  url?: string | null;
  index: number;
}

interface NavigationLike {
  canGoBack?: boolean;
  currentEntry?: NavigationHistoryEntry | null;
  entries?: () => NavigationHistoryEntry[];
}

function getNavigation(): NavigationLike | undefined {
  return (window as Window & { navigation?: NavigationLike }).navigation;
}

// Navigation API 的历史条目只含与当前页连续的同源记录，canGoBack 为真即上一页仍在站内
function canGoBackInApp(): boolean {
  return getNavigation()?.canGoBack === true;
}

function toPathAndSearch(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

// 上一条历史正是 returnTo 时用后退返回，浏览器与 PageScrollRestorer 才会恢复列表滚动位置
function isPreviousEntry(target: string): boolean {
  const navigation = getNavigation();
  const current = navigation?.currentEntry;
  if (!navigation?.canGoBack || !current || !navigation.entries) return false;
  const previous = navigation.entries()[current.index - 1];
  if (!previous?.url) return false;
  return toPathAndSearch(previous.url) === toPathAndSearch(target);
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
    const target = normalizeInternalReturnPath(returnTo, fallback);
    if (returnTo && isPreviousEntry(target)) {
      router.back();
      return;
    }
    router.replace(target);
  }, [fallbackHref, pathname, router]);
}
