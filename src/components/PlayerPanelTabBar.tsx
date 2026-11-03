import type { ReactNode } from 'react';

interface PlayerPanelTabBarProps<K extends string> {
  tabs: { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
}

interface PlayerPanelContentProps {
  children: ReactNode;
  className?: string;
}

// 点播与直播右侧面板外壳：标签栏与内容同在一块实底卡片内
export const PLAYER_PANEL_SURFACE_CLASS =
  'overflow-hidden rounded-xl bg-white ring-1 ring-gray-900/[0.06] dark:bg-gray-900 dark:ring-white/[0.06]';

export function PlayerPanelTabBar<K extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = '面板标签',
}: PlayerPanelTabBarProps<K>) {
  return (
    <nav
      aria-label={ariaLabel}
      className='scrollbar-hide flex h-12 flex-shrink-0 items-stretch gap-5 overflow-x-auto border-b border-gray-200/70 px-5 dark:border-white/[0.06]'
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type='button'
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex shrink-0 items-center whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
              isActive
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            {tab.label}
            {isActive && (
              <span className='absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-500 dark:bg-brand-400' />
            )}
          </button>
        );
      })}
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
