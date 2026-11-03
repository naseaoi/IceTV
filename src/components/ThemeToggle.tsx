'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { type MouseEvent, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const transitionInProgressRef = useRef(false);

  const setThemeColor = (theme?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const newMeta = document.createElement('meta');
      newMeta.name = 'theme-color';
      newMeta.content = theme === 'dark' ? '#0c111c' : '#f9fbfe';
      document.head.appendChild(newMeta);
    } else {
      meta.setAttribute('content', theme === 'dark' ? '#0c111c' : '#f9fbfe');
    }
  };

  // 监听主题变化和路由变化，确保主题色始终同步
  useEffect(() => {
    if (resolvedTheme) {
      setThemeColor(resolvedTheme);
    }
  }, [resolvedTheme, pathname]);

  const toggleTheme = (event: MouseEvent<HTMLButtonElement>) => {
    if (transitionInProgressRef.current) return;

    const targetTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeColor(targetTheme);

    const startViewTransition = document.startViewTransition;

    if (
      !startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setTheme(targetTheme);
      return;
    }

    const iconAnchor = event.currentTarget.querySelector<HTMLElement>(
      '[data-theme-transition-anchor]',
    );
    const rect = (iconAnchor ?? event.currentTarget).getBoundingClientRect();
    const viewportOffsetX = window.visualViewport?.offsetLeft ?? 0;
    const viewportOffsetY = window.visualViewport?.offsetTop ?? 0;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      setTheme(targetTheme);
      return;
    }

    const centerX = rect.left + rect.width / 2 + viewportOffsetX;
    const centerY = rect.top + rect.height / 2 + viewportOffsetY;
    const maxRadius = Math.hypot(
      Math.max(centerX, viewportWidth - centerX),
      Math.max(centerY, viewportHeight - centerY),
    );
    const centerXPercent = (centerX / viewportWidth) * 100;
    const centerYPercent = (centerY / viewportHeight) * 100;
    const radiusVmax =
      (maxRadius / Math.max(viewportWidth, viewportHeight)) * 100;

    const root = document.documentElement;
    root.style.setProperty('--theme-transition-x', `${centerXPercent}%`);
    root.style.setProperty('--theme-transition-y', `${centerYPercent}%`);
    root.style.setProperty('--theme-transition-radius', `${radiusVmax}vmax`);
    const clearTransitionStyles = () => {
      root.style.removeProperty('--theme-transition-x');
      root.style.removeProperty('--theme-transition-y');
      root.style.removeProperty('--theme-transition-radius');
    };

    transitionInProgressRef.current = true;

    let transition: ViewTransition;
    try {
      transition = startViewTransition.call(document, () => {
        flushSync(() => setTheme(targetTheme));
      });
    } catch {
      transitionInProgressRef.current = false;
      clearTransitionStyles();
      setTheme(targetTheme);
      return;
    }

    void transition.ready
      .then(() => {
        const animation = document.documentElement.animate(
          {
            clipPath: [
              'circle(0px at var(--theme-transition-x) var(--theme-transition-y))',
              'circle(var(--theme-transition-radius) at var(--theme-transition-x) var(--theme-transition-y))',
            ],
          },
          {
            duration: 380,
            easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
        return animation.finished.catch(() => undefined);
      })
      .catch(() => undefined);

    void transition.finished
      .catch(() => undefined)
      .finally(() => {
        transitionInProgressRef.current = false;
        clearTransitionStyles();
      });
  };

  return (
    <button
      onClick={toggleTheme}
      className={
        className ??
        'flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
      }
      aria-label='切换主题'
    >
      <span data-theme-transition-anchor className='h-5 w-5'>
        <Sun className='hidden h-full w-full dark:block' />
        <Moon className='h-full w-full dark:hidden' />
      </span>
    </button>
  );
}
