'use client';

import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ReactNode, RefObject } from 'react';

import PageLayout from '@/components/PageLayout';
import PlayerShortcutsModal from '@/components/PlayerShortcutsModal';
import type { PlayerShortcutMode } from '@/lib/player-shortcuts';

interface PlayerPageLayoutProps {
  activePath: string;
  title: string;
  titleFallback: string;
  isPanelCollapsed: boolean;
  onTogglePanel: () => void;
  panelToggleTitle: string;
  artRef: RefObject<HTMLDivElement | null>;
  titleSuffix?: ReactNode;
  tags?: ReactNode[];
  playerOverlay?: ReactNode;
  rightPanel: ReactNode;
  mobilePanelAlwaysVisible?: boolean;
  shortcutMode?: PlayerShortcutMode;
}

const TogglePanelButton = ({
  collapsed,
  onClick,
  title,
}: {
  collapsed: boolean;
  onClick: () => void;
  title: string;
}) => {
  const Icon = collapsed ? PanelRightOpen : PanelRightClose;
  return (
    <button
      type='button'
      onClick={onClick}
      className='inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
      title={title}
      aria-label={title}
    >
      <Icon className='h-4 w-4' />
      {collapsed ? '显示面板' : '收起面板'}
    </button>
  );
};

export function PlayerPageLayout({
  activePath,
  title,
  titleFallback,
  isPanelCollapsed,
  onTogglePanel,
  panelToggleTitle,
  artRef,
  titleSuffix,
  tags = [],
  playerOverlay,
  rightPanel,
  mobilePanelAlwaysVisible = false,
  shortcutMode = 'vod',
}: PlayerPageLayoutProps) {
  return (
    <PageLayout
      activePath={activePath}
      contentMode='player'
      showDesktopBack={false}
      mobileHeader={{ title: title || titleFallback }}
    >
      <div className='relative flex h-full min-h-0 flex-col overflow-hidden pb-2 md:mx-auto md:w-full md:max-w-[1680px] md:px-8 md:pb-6 xl:px-12'>
        <div className='hidden h-16 flex-shrink-0 items-center gap-3 md:flex'>
          <h1 className='min-w-0 truncate text-lg font-semibold text-gray-900 dark:text-gray-100'>
            {title || titleFallback}
          </h1>
          {titleSuffix && (
            <span className='max-w-[40%] flex-shrink-0 truncate text-sm text-gray-500 dark:text-gray-400'>
              {titleSuffix}
            </span>
          )}
          <div className='ml-auto hidden flex-shrink-0 split:block'>
            <TogglePanelButton
              collapsed={isPanelCollapsed}
              onClick={onTogglePanel}
              title={panelToggleTitle}
            />
          </div>
        </div>

        {/* 内容区：移动端与竖屏平板上下排列，分栏时播放器吃满剩余宽高 + 固定宽右面板 */}
        <div className='flex min-h-0 flex-1 flex-col split:flex-row'>
          <div className='relative aspect-video max-h-[38dvh] w-full flex-shrink-0 split:aspect-auto split:h-full split:max-h-none split:min-w-0 split:flex-1 phone-landscape:aspect-auto phone-landscape:max-h-none phone-landscape:min-h-0 phone-landscape:flex-1'>
            <div className='absolute inset-0'>
              <div
                ref={artRef}
                className='h-full w-full overflow-hidden bg-black md:rounded-xl'
              />
              {playerOverlay}
            </div>
          </div>

          {/* 移动端播放信息：标题 + 标签 */}
          <div className='flex-shrink-0 px-4 pt-3 phone-landscape:hidden md:hidden'>
            <div className='flex min-w-0 items-baseline gap-2'>
              <h1 className='min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100'>
                {title || titleFallback}
              </h1>
              {titleSuffix && (
                <span className='max-w-[45%] flex-shrink-0 truncate text-[13px] text-gray-500 dark:text-gray-400'>
                  {titleSuffix}
                </span>
              )}
            </div>
            {tags.length > 0 && (
              <div className='mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-medium'>
                {tags.map((tag, index) => (
                  <span key={index}>{tag}</span>
                ))}
              </div>
            )}
          </div>

          <div
            className={`min-h-0 overflow-hidden px-4 transition-[max-width,margin,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] split:mt-0 split:h-full split:w-[21rem] split:flex-none phone-landscape:hidden md:px-0 xl:w-[24rem] ${
              isPanelCollapsed
                ? `${
                    mobilePanelAlwaysVisible ? 'mt-3 flex-1' : 'hidden'
                  } split:pointer-events-none split:ml-0 split:mt-0 split:block split:max-w-0 split:flex-none split:opacity-0`
                : 'mt-3 flex-1 split:ml-6 split:max-w-[24rem] split:opacity-100'
            }`}
          >
            {rightPanel}
          </div>
        </div>
      </div>
      <PlayerShortcutsModal mode={shortcutMode} />
    </PageLayout>
  );
}
