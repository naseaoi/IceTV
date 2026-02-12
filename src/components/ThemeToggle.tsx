/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps */

'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const setThemeColor = (theme?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = theme === 'dark' ? '#0c111c' : '#f9fbfe';
      document.head.appendChild(meta);
    } else {
      meta.setAttribute('content', theme === 'dark' ? '#0c111c' : '#f9fbfe');
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // 监听主题变化和路由变化，确保主题色始终同步
  useEffect(() => {
    if (mounted) {
      setThemeColor(resolvedTheme);
    }
  }, [mounted, resolvedTheme, pathname]);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className='w-10 h-10' />;
  }

  const toggleTheme = () => {
    const targetTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeColor(targetTheme);

    const startViewTransition = (document as any).startViewTransition as
      | ((callback: () => void) => { ready: Promise<void> })
      | undefined;

    if (
      !startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setTheme(targetTheme);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const maxRadius = Math.hypot(
      Math.max(centerX, window.innerWidth - centerX),
      Math.max(centerY, window.innerHeight - centerY),
    );

    const root = document.documentElement;
    root.style.setProperty('--theme-transition-x', `${centerX}px`);
    root.style.setProperty('--theme-transition-y', `${centerY}px`);
    root.style.setProperty('--theme-transition-radius', `${maxRadius}px`);

    const transition = startViewTransition.call(document, () => {
      setTheme(targetTheme);
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              'circle(0px at var(--theme-transition-x) var(--theme-transition-y))',
              'circle(var(--theme-transition-radius) at var(--theme-transition-x) var(--theme-transition-y))',
            ],
          },
          {
            duration: 380,
            easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      })
      .catch(() => undefined);
  };

  return (
    <button
      ref={buttonRef}
      onClick={toggleTheme}
      className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
      aria-label='Toggle theme'
    >
      {resolvedTheme === 'dark' ? (
        <Sun className='w-full h-full' />
      ) : (
        <Moon className='w-full h-full' />
      )}
    </button>
  );
}
