'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

// 记录本会话内的路由访问栈，用于判断从当前页返回首页时
// 能否直接 back()（复用 history + 滚动还原 + 客户端状态不丢）
// 还是需要 push('/')（无合适回退目标时）。
const navStack: string[] = [];

function pushPath(path: string) {
  if (navStack[navStack.length - 1] === path) return;
  navStack.push(path);
  if (navStack.length > 20) navStack.shift();
}

/**
 * 返回一个"智能跳转首页"回调：
 * - 若栈中上一条是 '/'，调用 router.back() 复用浏览器历史；
 * - 否则调用 router.push('/')。
 * 同时维护路由访问栈。
 */
export function useSmartHomeNav() {
  const pathname = usePathname();
  const router = useRouter();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const queryString =
      typeof window === 'undefined'
        ? ''
        : window.location.search.replace(/^\?/, '');
    const currentPath = queryString ? `${pathname}?${queryString}` : pathname;
    if (lastPathRef.current !== currentPath) {
      pushPath(currentPath);
      lastPathRef.current = currentPath;
    }
  });

  return useCallback(() => {
    const prev = navStack[navStack.length - 2];
    if (prev === '/') {
      // 弹出当前页，回到 '/'；栈里同步移除一条，保持后续判断准确
      navStack.pop();
      router.back();
      return;
    }
    router.push('/');
  }, [router]);
}
