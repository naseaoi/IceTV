'use client';

import { ReactNode, RefObject } from 'react';

import { LucideIcon } from 'lucide-react';

import { BackButton } from '@/components/BackButton';
import PageLayout from '@/components/PageLayout';

export interface PlayerPageAccent {
  icon: string;
  glow: string;
  sub: string;
}

interface PlayerPageLayoutProps {
  activePath: string;
  title: string;
  titleFallback: string;
  titleIcon: LucideIcon;
  accent: PlayerPageAccent;
  isPanelCollapsed: boolean;
  onTogglePanel: () => void;
  panelToggleTitle: string;
  artRef: RefObject<HTMLDivElement | null>;
  titleSuffix?: ReactNode;
  tags?: ReactNode[];
  playerOverlay?: ReactNode;
  rightPanel: ReactNode;
}

const TogglePanelButton = ({
  collapsed,
  onClick,
  title,
}: {
  collapsed: boolean;
  onClick: () => void;
  title: string;
}) => (
  <button
    onClick={onClick}
    className='flex items-center gap-2 rounded-full p-2.5 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
    title={title}
  >
    <svg
      className={`h-5 w-5 transition-transform duration-200 ${
        collapsed ? 'rotate-180' : 'rotate-0'
      }`}
      fill='none'
      stroke='currentColor'
      viewBox='0 0 24 24'
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='2'
        d='M9 5l7 7-7 7'
      />
    </svg>
    <span className='text-sm font-medium'>{collapsed ? '显示' : '隐藏'}</span>
  </button>
);

const TitleIconBadge = ({
  icon: Icon,
  accent,
  size = 'md',
}: {
  icon: LucideIcon;
  accent: PlayerPageAccent;
  size?: 'md' | 'lg';
}) => (
  <span className='relative flex-shrink-0'>
    <Icon
      className={`${size === 'lg' ? 'h-8 w-8' : 'h-6 w-6'} ${accent.icon}`}
    />
    <span
      className={`absolute ${
        size === 'lg' ? '-inset-2' : '-inset-1.5'
      } rounded-full ${accent.glow} blur-sm`}
    />
  </span>
);

export function PlayerPageLayout({
  activePath,
  title,
  titleFallback,
  titleIcon: TitleIcon,
  accent,
  isPanelCollapsed,
  onTogglePanel,
  panelToggleTitle,
  artRef,
  titleSuffix,
  tags = [],
  playerOverlay,
  rightPanel,
}: PlayerPageLayoutProps) {
  return (
    <PageLayout
      activePath={activePath}
      contentMode='player'
      showDesktopBack={false}
    >
      <div className='relative flex h-full min-h-0 flex-col overflow-hidden px-4 py-2 sm:px-6'>
        {/* 移动端头部：居中标题 + 标签 */}
        <div className='relative flex-shrink-0 pb-3 pt-1 md:hidden'>
          <h1 className='flex min-w-0 items-center justify-center gap-2.5 text-xl font-bold text-gray-900 dark:text-gray-100'>
            <TitleIconBadge icon={TitleIcon} accent={accent} />
            <span className='max-w-[60vw] truncate'>
              {title || titleFallback}
            </span>
            {titleSuffix && (
              <>
                <span className='h-4 w-px flex-shrink-0 bg-gray-300 dark:bg-gray-600' />
                <span
                  className={`text-sm font-semibold ${accent.sub} flex-shrink-0 whitespace-nowrap`}
                >
                  {titleSuffix}
                </span>
              </>
            )}
          </h1>
          {tags.length > 0 && (
            <div className='mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium'>
              {tags.map((tag, index) => (
                <span key={index}>{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* 桌面端单行顶栏 */}
        <div className='relative hidden h-[5.5rem] flex-shrink-0 items-center gap-4 md:flex'>
          <BackButton variant='icon' />
          <TitleIconBadge icon={TitleIcon} accent={accent} size='lg' />
          <h1 className='min-w-0 truncate text-2xl font-bold text-gray-900 dark:text-gray-100'>
            {title || titleFallback}
          </h1>
          {titleSuffix && (
            <>
              <span className='h-5 w-px flex-shrink-0 bg-gray-300 dark:bg-gray-600' />
              <span
                className={`text-lg font-semibold ${accent.sub} flex-shrink-0 whitespace-nowrap`}
              >
                {titleSuffix}
              </span>
            </>
          )}
          <div className='ml-auto hidden flex-shrink-0 lg:block'>
            <TogglePanelButton
              collapsed={isPanelCollapsed}
              onClick={onTogglePanel}
              title={panelToggleTitle}
            />
          </div>
        </div>

        {/* 内容区：移动端上下排列，桌面端播放器吃满剩余宽高 + 固定宽右面板 */}
        <div className='flex min-h-0 flex-1 flex-col md:flex-row'>
          <div className='relative aspect-video max-h-[38dvh] w-full flex-shrink-0 md:aspect-auto md:h-full md:max-h-none md:min-w-0 md:flex-1'>
            <div className='absolute inset-0'>
              <div
                ref={artRef}
                className='h-full w-full overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-black/10 dark:ring-white/10'
              />
              {playerOverlay}
            </div>
          </div>

          <div
            className={`min-h-0 overflow-hidden transition-[max-width,margin,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] md:mt-0 md:h-full md:w-[21rem] md:flex-none xl:w-[24rem] ${
              isPanelCollapsed
                ? 'hidden md:pointer-events-none md:ml-0 md:block md:max-w-0 md:opacity-0'
                : 'mt-3 flex-1 md:ml-3 md:max-w-[24rem] md:opacity-100'
            }`}
          >
            {rightPanel}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
