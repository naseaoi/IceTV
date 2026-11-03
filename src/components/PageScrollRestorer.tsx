'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';

import {
  getPageScrollTop,
  scrollPageTo,
  subscribePageScroll,
} from '@/hooks/usePageScroll';

const RESTORE_TIMEOUT_MS = 1500;

function currentKey() {
  return `${window.location.pathname}${window.location.search}`;
}

// Next 导航只重置 documentElement 的滚动，而本站滚动在 body 上，会残留上一页的位置。
// 换页时由这里接管：新页面回到顶部，浏览器前进后退恢复离开时的位置。
export function PageScrollRestorer() {
  const pathname = usePathname();
  const positions = useRef(new Map<string, number>());
  const last = useRef<{ key: string; top: number } | null>(null);
  const popPathname = useRef<string | null>(null);
  const cancelRestore = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onPopState = () => {
      popPathname.current = window.location.pathname;
    };
    const onScroll = () => {
      last.current = { key: currentKey(), top: getPageScrollTop() };
    };
    window.addEventListener('popstate', onPopState);
    const unsubscribe = subscribePageScroll(onScroll);
    return () => {
      window.removeEventListener('popstate', onPopState);
      unsubscribe();
      cancelRestore.current?.();
    };
  }, []);

  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { key: currentKey(), top: 0 };
    // 首次挂载保留浏览器自身的位置
    if (!previous) {
      last.current.top = getPageScrollTop();
      return;
    }
    positions.current.set(previous.key, previous.top);
    cancelRestore.current?.();
    cancelRestore.current = null;

    const isPop = popPathname.current === pathname;
    popPathname.current = null;
    const target = isPop ? (positions.current.get(currentKey()) ?? 0) : 0;
    scrollPageTo(target);
    if (target === 0) return;

    // 内容可能还在加载，高度不够时持续补位，用户一旦操作就停止
    let frame = 0;
    const deadline = performance.now() + RESTORE_TIMEOUT_MS;
    const stop = () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', stop);
    };
    const tick = () => {
      if (Math.abs(getPageScrollTop() - target) < 2) return stop();
      if (performance.now() > deadline) return stop();
      scrollPageTo(target);
      frame = window.requestAnimationFrame(tick);
    };
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('keydown', stop);
    frame = window.requestAnimationFrame(tick);
    cancelRestore.current = stop;
  }, [pathname]);

  return null;
}
