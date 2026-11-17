'use client';

import { useEffect } from 'react';

// 只锁 html：它的 overflow 会传给视口。body 一旦也设成 hidden 就成了滚动容器，
// 页面里的 sticky 元素（顶栏、子栏）改为相对 body 吸附，页面已滚动时被移出视口。
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const html = document.documentElement;
    const originalHtmlOverflow = html.style.overflow;
    html.style.overflow = 'hidden';

    return () => {
      html.style.overflow = originalHtmlOverflow;
    };
  }, [active]);
}
