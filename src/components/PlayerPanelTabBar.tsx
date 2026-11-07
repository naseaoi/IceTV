import type { ReactNode } from 'react';

import { useSlidingIndicator } from '@/hooks/useSlidingIndicator';

interface PlayerPanelTabBarProps<K extends string> {
  tabs: { key: K; label: string; count?: number }[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
}

interface PlayerPanelContentProps {
  children: ReactNode;
  className?: string;
}

// 标签栏与各子标签内容共用，保证左边缘对齐
export const PLAYER_PANEL_INSET_CLASS = 'px-5';

// 点播与直播右侧面板外壳：标签栏与内容同在一块实底卡片内
export const PLAYER_PANEL_SURFACE_CLASS =
  'overflow-hidden rounded-xl bg-white ring-1 ring-gray-900/[0.06] dark:bg-gray-900 dark:ring-white/[0.06]';

const TAB_INDICATOR_CLASS = 'h-0.5 rounded-full bg-brand-500 dark:bg-brand-400';

export function PlayerPanelTabBar<K extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = '面板标签',
}: PlayerPanelTabBarProps<K>) {
  const indicator = useSlidingIndicator<HTMLElement>(active);
  return (
    <nav
      ref={indicator.containerRef}
      aria-label={ariaLabel}
      className={`scrollbar-hide relative flex h-12 flex-shrink-0 items-stretch gap-5 overflow-x-auto border-b border-gray-200/70 dark:border-white/[0.06] ${PLAYER_PANEL_INSET_CLASS}`}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type='button'
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
            data-indicator-target={isActive || undefined}
            className={`relative flex shrink-0 items-center whitespace-nowrap text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
              isActive
                ? 'font-semibold text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className='ml-1 text-xs font-normal tabular-nums text-gray-400 dark:text-gray-500'>
                {tab.count}
              </span>
            )}
            {isActive && !indicator.indicatorProps && (
              <span
                className={`absolute inset-x-0 -bottom-px ${TAB_INDICATOR_CLASS}`}
              />
            )}
          </button>
        );
      })}
      {indicator.indicatorProps && (
        <span
          aria-hidden='true'
          className={`sliding-indicator -mt-px ${TAB_INDICATOR_CLASS}`}
          {...indicator.indicatorProps}
        />
      )}
    </nav>
  );
}

export function PlayerPanelContent({
  children,
  className = '',
}: PlayerPanelContentProps) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${className}`.trim()}
    >
      {children}
    </div>
  );
}
