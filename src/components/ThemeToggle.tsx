'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useRef } from 'react';

import {
  getSidebarItemLabelClass,
  SIDEBAR_BUTTON_STATE_CLASS,
  SIDEBAR_ITEM_ICON_CLASS,
  SIDEBAR_ITEM_ICON_WRAP_CLASS,
  SIDEBAR_ITEM_LAYOUT_CLASS,
} from './SidebarItem';

interface ThemeToggleProps {
  variant?: 'icon' | 'sidebar';
  isCollapsed?: boolean;
  className?: string;
}

export function ThemeToggle({
  variant = 'icon',
  isCollapsed = false,
  className,
}: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

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
            easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      })
      .catch(() => undefined);
  };

  if (variant === 'sidebar') {
    return (
      <button
        ref={buttonRef}
        onClick={toggleTheme}
        className={`${SIDEBAR_ITEM_LAYOUT_CLASS} w-full ${SIDEBAR_BUTTON_STATE_CLASS}`}
        aria-label='主题'
        title='主题'
      >
        <div className={SIDEBAR_ITEM_ICON_WRAP_CLASS}>
          <Sun className={`${SIDEBAR_ITEM_ICON_CLASS} hidden dark:block`} />
          <Moon className={`${SIDEBAR_ITEM_ICON_CLASS} dark:hidden`} />
        </div>
        <span className={getSidebarItemLabelClass(isCollapsed)}>主题</span>
      </button>
    );
  }

  return (
    <button
      ref={buttonRef}
      onClick={toggleTheme}
      className={
        className ??
        'flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
      }
      aria-label='切换主题'
    >
      <Sun className='hidden h-full w-full dark:block' />
      <Moon className='h-full w-full dark:hidden' />
    </button>
  );
}
