'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useSmartHomeNav } from '@/hooks/useSmartHomeNav';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  const router = useRouter();
  const goHome = useSmartHomeNav();

  useEffect(() => {
    router.prefetch('/search');
  }, [router]);

  return (
    <header className='fixed left-0 right-0 top-0 z-[999] w-full border-b border-gray-200/50 bg-white/70 shadow-sm backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/70 md:hidden'>
      <div className='grid h-12 grid-cols-3 items-center px-3'>
        <div className='flex min-w-0 items-center justify-start gap-1'>
          <Link
            href='/search'
            onClick={(e) => {
              const authInfo = getAuthInfoFromBrowserCookie();
              if (!authInfo?.username) {
                e.preventDefault();
                router.push('/login?redirect=%2Fsearch');
              }
            }}
            className='flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
          >
            <svg
              className='h-full w-full'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
              />
            </svg>
          </Link>
          {showBackButton && <BackButton />}
        </div>

        <Link
          href='/'
          onClick={(e) => {
            e.preventDefault();
            goHome();
          }}
          className='mx-auto block max-w-full truncate px-1 text-center text-xl font-bold tracking-tight text-green-600 transition-opacity hover:opacity-80'
        >
          {siteName}
        </Link>

        <div className='flex min-w-0 items-center justify-end gap-1'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
