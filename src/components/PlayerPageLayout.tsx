'use client';

import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactNode, RefObject } from 'react';

import PageLayout from '@/components/PageLayout';
import PlayerShortcutsModal from '@/components/PlayerShortcutsModal';
import { useBackNavigation } from '@/hooks/useBackNavigation';
import type { PlayerShortcutMode } from '@/lib/player-shortcuts';

import { FLOATING_CONTROL_CLASS } from './floating-control';

interface PlayerPageLayoutProps {
  activePath: string;
  title: string;
  titleFallback: string;
  isPanelCollapsed: boolean;
  onTogglePanel: () => void;
  artRef: RefObject<HTMLDivElement | null>;
  titleSuffix?: ReactNode;
  tags?: ReactNode[];
  playerOverlay?: ReactNode;
  rightPanel: ReactNode;
  mobilePanelAlwaysVisible?: boolean;
  shortcutMode?: PlayerShortcutMode;
}

const PANEL_TRANSITION_CLASS =
  'duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]';

// 骑在面板左边线上，收起后随面板宽度归零落到播放器右边线上
const TogglePanelButton = ({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) => {
  const Icon = collapsed ? ChevronLeft : ChevronRight;
  const title = collapsed ? '展开面板' : '收起面板';
  return (
    <div
      className={`pointer-events-none absolute top-1/2 z-10 hidden -translate-y-1/2 translate-x-1/2 transition-[right] split:block ${PANEL_TRANSITION_CLASS} ${
        collapsed ? 'right-0' : 'right-[21rem] xl:right-[24rem]'
      }`}
    >
      <button
        type='button'
        onClick={onClick}
        className={`${FLOATING_CONTROL_CLASS} pointer-events-auto h-14 w-5`}
        title={title}
        aria-label={title}
        aria-expanded={!collapsed}
      >
        <Icon className='h-4 w-4' strokeWidth={2.25} />
      </button>
    </div>
  );
};

const DesktopBackButton = () => {
  const goBack = useBackNavigation();
  return (
    <button
      type='button'
      onClick={goBack}
      className='-ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
      title='返回'
      aria-label='返回'
    >
      <ArrowLeft className='h-[18px] w-[18px]' />
    </button>
  );
};

export function PlayerPageLayout({
  activePath,
  title,
  titleFallback,
  isPanelCollapsed,
  onTogglePanel,
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
          <DesktopBackButton />
          <h1 className='-ml-1 min-w-0 truncate text-lg font-semibold text-gray-900 dark:text-gray-100'>
            {title || titleFallback}
          </h1>
          {titleSuffix && (
            <span className='max-w-[40%] flex-shrink-0 truncate text-sm text-gray-500 dark:text-gray-400'>
              {titleSuffix}
            </span>
          )}
        </div>

        {/* 内容区：移动端与竖屏平板上下排列，分栏时播放器吃满剩余宽高 + 固定宽右面板 */}
        <div className='relative flex min-h-0 flex-1 flex-col split:flex-row'>
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
            className={`min-h-0 overflow-hidden px-4 transition-[max-width,margin,opacity] ${PANEL_TRANSITION_CLASS} split:mt-0 split:h-full split:w-[21rem] split:flex-none phone-landscape:hidden md:px-0 xl:w-[24rem] ${
              isPanelCollapsed
                ? `${
                    mobilePanelAlwaysVisible ? 'mt-3 flex-1' : 'hidden'
                  } split:pointer-events-none split:ml-0 split:mt-0 split:block split:max-w-0 split:flex-none split:opacity-0`
                : 'mt-3 flex-1 split:ml-6 split:max-w-[21rem] split:opacity-100 xl:max-w-[24rem]'
            }`}
          >
            {rightPanel}
          </div>

          <TogglePanelButton
            collapsed={isPanelCollapsed}
            onClick={onTogglePanel}
          />
        </div>
      </div>
      <PlayerShortcutsModal mode={shortcutMode} />
    </PageLayout>
  );
}
