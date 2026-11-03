'use client';

import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

import { useHideOnScrollDown } from '@/hooks/usePageScroll';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';

interface MobileHeaderProps {
  title?: string;
  showBack?: boolean;
  actions?: ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  '/me': '我的',
  '/settings': '设置',
  '/admin': '管理后台',
};

const HEADER_SURFACE_CLASS =
  'fixed inset-x-0 top-0 z-[999] w-full border-b border-gray-200/70 bg-gray-50/90 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/85 md:hidden';

function getVariant(pathname: string): 'player' | 'page' {
  return pathname.startsWith('/play') || pathname.startsWith('/live')
    ? 'player'
    : 'page';
}

const MobileHeader = ({
  title,
  showBack = true,
  actions,
}: MobileHeaderProps) => {
  const { siteName } = useSite();
  const pathname = usePathname() ?? '/';
  const variant = getVariant(pathname);
  const hidden = useHideOnScrollDown(variant === 'page');

  const resolvedTitle = title || PAGE_TITLES[pathname] || siteName;

  return (
    <header
      className={`${HEADER_SURFACE_CLASS} transition-transform duration-300 ease-out ${
        hidden ? '-translate-y-full' : 'translate-y-0'
      }`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {variant === 'page' && (
        <div
          className={`flex h-12 items-center gap-1 pr-2 ${showBack ? 'pl-1' : 'pl-4'}`}
        >
          {showBack && <BackButton />}
          <h1 className='min-w-0 flex-1 truncate text-[17px] font-semibold text-gray-900 dark:text-gray-100'>
            {resolvedTitle}
          </h1>
          <div className='flex shrink-0 items-center gap-1'>{actions}</div>
        </div>
      )}

      {variant === 'player' && (
        <div className='grid h-12 grid-cols-[2.5rem_1fr_2.5rem] items-center px-4'>
          <BackButton />
          <h1 className='truncate px-1 text-center text-base font-semibold text-gray-900 dark:text-gray-100'>
            {resolvedTitle}
          </h1>
          <div className='flex items-center justify-end'>{actions}</div>
        </div>
      )}
    </header>
  );
};

export default MobileHeader;
