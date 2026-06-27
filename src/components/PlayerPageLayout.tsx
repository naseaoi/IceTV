'use client';

import { ReactNode, RefObject, useEffect, useRef, useState } from 'react';

import { LucideIcon } from 'lucide-react';

import { BackButton } from '@/components/BackButton';
import PageLayout from '@/components/PageLayout';

export interface PlayerPageAccent {
  icon: string;
  glow: string;
  sub: string;
  aurora: [string, string];
  auroraLight: [string, string];
}

interface PlayerPageLayoutProps {
  activePath: string;
  title: string;
  titleFallback: string;
  titleIcon: LucideIcon;
  accent: PlayerPageAccent;
  isPlaying: boolean;
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
    className='flex items-center gap-1.5 rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
    title={title}
  >
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${
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
    <span className='text-xs font-medium'>{collapsed ? '显示' : '隐藏'}</span>
  </button>
);

export function PlayerPageLayout({
  activePath,
  title,
  titleFallback,
  titleIcon: TitleIcon,
  accent,
  isPlaying,
  isPanelCollapsed,
  onTogglePanel,
  panelToggleTitle,
  artRef,
  titleSuffix,
  tags = [],
  playerOverlay,
  rightPanel,
}: PlayerPageLayoutProps) {
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);
  const expandedHeightRef = useRef<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const el = playerWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) {
        setPlayerHeight(h);
        if (!isPanelCollapsed) {
          expandedHeightRef.current = h;
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isPanelCollapsed]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <PageLayout
      activePath={activePath}
      contentMode='player'
      showDesktopBack={false}
    >
      <div className='relative flex h-full min-h-0 flex-col gap-3 overflow-hidden px-4 py-2 sm:px-6 md:overflow-visible lg:px-[3rem] 2xl:px-20'>
        <div className='pointer-events-none absolute -inset-x-16 top-0 h-80 overflow-hidden'>
          <div
            className='absolute inset-0 dark:hidden'
            style={{
              background: [
                `radial-gradient(ellipse 90% 60% at 30% 0%, rgba(${accent.aurora[0]},0.10) 0%, transparent 70%)`,
                `radial-gradient(ellipse 60% 50% at 70% 5%, rgba(${accent.aurora[1]},0.08) 0%, transparent 70%)`,
                `radial-gradient(ellipse 50% 45% at 45% 20%, rgba(${accent.aurora[0]},0.06) 0%, transparent 65%)`,
              ].join(', '),
              animation: 'aurora-breathe 8s ease-in-out infinite',
              animationPlayState: isPlaying ? 'running' : 'paused',
              transformOrigin: 'top center',
              mask: 'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
              WebkitMask:
                'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
            }}
          />
          <div
            className='absolute inset-0 hidden dark:block'
            style={{
              background: [
                `radial-gradient(ellipse 90% 60% at 30% 0%, rgba(${accent.auroraLight[0]},0.16) 0%, transparent 70%)`,
                `radial-gradient(ellipse 60% 50% at 70% 5%, rgba(${accent.auroraLight[1]},0.12) 0%, transparent 70%)`,
                `radial-gradient(ellipse 50% 45% at 45% 20%, rgba(${accent.auroraLight[0]},0.09) 0%, transparent 65%)`,
              ].join(', '),
              animation: 'aurora-breathe 8s ease-in-out infinite',
              animationPlayState: isPlaying ? 'running' : 'paused',
              transformOrigin: 'top center',
              mask: 'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
              WebkitMask:
                'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
            }}
          />
        </div>

        <div className='h-1 flex-shrink-0 sm:h-4' />

        <div className='relative flex-shrink-0 pb-3'>
          <div className='flex justify-center'>
            <h1 className='flex min-w-0 items-center gap-2.5 text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl'>
              <span className='relative flex-shrink-0'>
                <TitleIcon className={`h-6 w-6 ${accent.icon}`} />
                <span
                  className={`absolute -inset-1.5 rounded-full ${accent.glow} blur-sm`}
                />
              </span>
              <span className='max-w-[60vw] truncate sm:max-w-[50vw]'>
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
          </div>

          <div className='relative mt-2 flex min-h-[1.75rem] items-center justify-center md:justify-between'>
            <div className='hidden flex-shrink-0 md:block'>
              <BackButton />
            </div>

            <div className='flex items-center justify-center md:pointer-events-none md:absolute md:inset-0'>
              <div className='flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium'>
                {tags.map((tag, index) => (
                  <span key={index}>{tag}</span>
                ))}
              </div>
            </div>

            <div className='hidden flex-shrink-0 lg:block'>
              <TogglePanelButton
                collapsed={isPanelCollapsed}
                onClick={onTogglePanel}
                title={panelToggleTitle}
              />
            </div>
          </div>
        </div>

        <div className='h-px flex-shrink-0 bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />

        <div
          className={`grid min-h-0 flex-1 ${
            isPanelCollapsed
              ? 'grid-cols-1'
              : 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 md:grid-cols-4 md:grid-rows-1'
          }`}
        >
          <div
            className={`overflow-hidden rounded-xl ${
              isPanelCollapsed ? 'col-span-1' : 'md:col-span-3'
            }`}
          >
            <div
              ref={playerWrapRef}
              className={`relative max-h-[38dvh] w-full md:max-h-[80vh] ${
                isPanelCollapsed ? '' : 'aspect-video'
              }`}
              style={
                isPanelCollapsed && expandedHeightRef.current
                  ? { height: `${expandedHeightRef.current}px` }
                  : undefined
              }
            >
              <div className='absolute inset-0'>
                <div
                  ref={artRef}
                  className='h-full w-full overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-black/10 dark:ring-white/10'
                />
                {playerOverlay}
              </div>
            </div>
          </div>

          <div
            className={`min-h-0 overflow-hidden ${
              isPanelCollapsed
                ? 'h-0 md:col-span-1 lg:pointer-events-none lg:max-w-0 lg:opacity-0'
                : 'md:col-span-1 lg:max-w-[100%] lg:opacity-100'
            }`}
            style={
              isPanelCollapsed
                ? undefined
                : playerHeight
                  ? isDesktop
                    ? { height: `${playerHeight}px` }
                    : { height: '100%' }
                  : isDesktop
                    ? { height: '300px' }
                    : { height: '100%' }
            }
          >
            {rightPanel}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
