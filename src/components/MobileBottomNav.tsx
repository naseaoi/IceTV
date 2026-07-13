'use client';

import { Home, LayoutGrid, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type MobileNavItem = {
  icon: typeof Home;
  label: string;
  href: string;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: MobileNavItem[] = [
  {
    icon: Home,
    label: '首页',
    href: '/',
    match: (pathname) => pathname === '/',
  },
  {
    icon: LayoutGrid,
    label: '分类',
    href: '/categories',
    match: (pathname) =>
      pathname.startsWith('/categories') ||
      pathname.startsWith('/douban') ||
      pathname.startsWith('/live'),
  },
  {
    icon: Search,
    label: '搜索',
    href: '/search',
    match: (pathname) => pathname.startsWith('/search'),
  },
  {
    icon: UserRound,
    label: '我的',
    href: '/me',
    match: (pathname) => pathname.startsWith('/me'),
  },
];

const MobileBottomNav = () => {
  const pathname = usePathname();
  const currentActive = pathname ?? '/';

  return (
    <nav
      className='fixed left-0 right-0 z-[600] overflow-hidden border-t border-gray-200/50 bg-white/90 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/80 md:hidden'
      style={{
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <ul className='flex items-center'>
        {NAV_ITEMS.map((item) => {
          const active = item.match(currentActive);
          return (
            <li key={item.href} className='min-w-0 flex-1'>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className='flex h-14 w-full flex-col items-center justify-center gap-1 text-xs'
              >
                <span
                  className={`flex items-center justify-center rounded-full px-3 py-0.5 ${
                    active ? 'bg-green-500/10 dark:bg-green-400/10' : ''
                  }`}
                >
                  <item.icon
                    className={`h-[22px] w-[22px] ${
                      active
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  />
                </span>
                <span
                  className={
                    active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-600 dark:text-gray-300'
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
