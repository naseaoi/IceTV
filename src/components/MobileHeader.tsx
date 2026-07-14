'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

import { useSmartHomeNav } from '@/hooks/useSmartHomeNav';

import { BackButton } from './BackButton';
import { SiteIcon } from './Sidebar';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  title?: string;
  showBack?: boolean;
  actions?: ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  '/categories': '分类',
  '/me': '我的',
};

function getVariant(pathname: string): 'home' | 'player' | 'search' | 'page' {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/play') || pathname.startsWith('/live')) {
    return 'player';
  }
  if (pathname.startsWith('/search')) return 'search';
  return 'page';
}

const MobileHeader = ({ title, showBack, actions }: MobileHeaderProps) => {
  const { siteName } = useSite();
  const pathname = usePathname() ?? '/';
  const goHome = useSmartHomeNav();

  const variant = getVariant(pathname);

  if (variant === 'search') {
    return null;
  }

  const resolvedTitle = title || PAGE_TITLES[pathname] || siteName;

  return (
    <header
      className='fixed left-0 right-0 top-0 z-[999] w-full border-b border-gray-200/50 bg-white/70 shadow-sm backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/70 md:hidden'
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {variant === 'home' && (
        <div className='flex h-12 items-center justify-between px-4'>
          <Link
            href='/'
            onClick={(e) => {
              e.preventDefault();
              goHome();
            }}
            className='flex max-w-[60vw] items-center gap-2 transition-opacity hover:opacity-80'
          >
            <span className='h-7 w-7 shrink-0'>
              <SiteIcon />
            </span>
            <span className='truncate text-xl font-bold tracking-tight text-gray-900 dark:text-white'>
              {siteName}
            </span>
          </Link>
          <div className='flex items-center gap-1'>
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      )}

      {variant === 'page' && (
        <div className='flex h-12 items-center justify-between gap-2 px-4'>
          <div className='flex min-w-0 items-center gap-1'>
            {showBack && <BackButton />}
            <h1 className='truncate text-lg font-bold text-gray-900 dark:text-gray-100'>
              {resolvedTitle}
            </h1>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            {actions ?? (
              <>
                <ThemeToggle />
                <UserMenu />
              </>
            )}
          </div>
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
