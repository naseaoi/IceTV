'use client';

import { useSyncExternalStore } from 'react';

export const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

const getClientSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getServerSnapshot = () => null;

// 服务端与水合阶段返回 null（视口未知），需要两套布局都渲染时由 CSS 断点兜底
export function useIsMobileViewport(): boolean | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
