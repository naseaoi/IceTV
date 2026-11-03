'use client';

import { useEffect, useState } from 'react';

// 部分浏览器与 PWA 外壳的滚动发生在 body 而非 window 上，三处都要监听
function getScrollTargets(): Array<Window | HTMLElement> {
  return [window, document.documentElement, document.body];
}

export function getPageScrollTop(): number {
  return (
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

export function subscribePageScroll(listener: () => void): () => void {
  const targets = getScrollTargets();
  targets.forEach((target) =>
    target.addEventListener('scroll', listener, { passive: true }),
  );
  return () =>
    targets.forEach((target) => target.removeEventListener('scroll', listener));
}

export function scrollPageToTop(behavior: ScrollBehavior = 'smooth') {
  scrollPageTo(0, behavior);
}

export function scrollPageTo(top: number, behavior: ScrollBehavior = 'auto') {
  const options: ScrollToOptions = { top, behavior };
  window.scrollTo(options);
  for (const element of [document.documentElement, document.body]) {
    if (element.scrollTo) {
      element.scrollTo(options);
    } else {
      element.scrollTop = top;
    }
  }
}

export function usePageScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(getPageScrollTop() > threshold);
    update();
    return subscribePageScroll(update);
  }, [threshold]);

  return scrolled;
}

const HIDE_AFTER_PX = 56;
const DIRECTION_SLOP_PX = 6;

// 向下滚动超过顶栏高度后收起，向上滚动即恢复
export function useHideOnScrollDown(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = getPageScrollTop();
    const update = () => {
      const top = getPageScrollTop();
      const delta = top - last;
      if (top <= HIDE_AFTER_PX) {
        setHidden(false);
      } else if (delta > DIRECTION_SLOP_PX) {
        setHidden(true);
      } else if (delta < -DIRECTION_SLOP_PX) {
        setHidden(false);
      }
      if (Math.abs(delta) > DIRECTION_SLOP_PX || top <= HIDE_AFTER_PX) {
        last = top;
      }
    };
    return subscribePageScroll(update);
  }, [enabled]);

  return hidden;
}
