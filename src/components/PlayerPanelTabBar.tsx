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

const tabBaseClass =
  'relative flex shrink-0 origin-bottom-left transform-gpu items-center justify-center whitespace-nowrap rounded-t-lg border text-center transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-green-500/70';

const activeTabClass =
  'z-10 -mb-px scale-[1.04] border-gray-200 border-b-transparent bg-white/80 px-5 py-3 text-sm font-semibold text-green-700 backdrop-blur-md dark:border-white/10 dark:border-b-transparent dark:bg-gray-800/50 dark:text-green-300';

const idleTabClass =
  'border-transparent bg-gray-100/70 px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-200/70 hover:text-gray-700 dark:bg-gray-800/30 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200';

const panelContentClass =
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl rounded-tl-none border border-gray-200 bg-white/60 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.04]';

export function PlayerPanelTabBar<K extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = '面板标签',
}: PlayerPanelTabBarProps<K>) {
  return (
    <nav
      aria-label={ariaLabel}
      className='flex h-[52px] flex-shrink-0 items-end gap-1.5 overflow-x-auto pr-1'
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type='button'
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
            className={`${tabBaseClass} ${
              isActive ? activeTabClass : idleTabClass
            }`}
          >
            <span className='min-w-0 truncate'>{tab.label}</span>
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
    <div className={`${panelContentClass} ${className}`.trim()}>{children}</div>
  );
}
