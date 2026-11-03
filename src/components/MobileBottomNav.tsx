'use client';

import { Home, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useIntentPrefetch } from '@/hooks/useIntentPrefetch';
import { scrollPageToTop } from '@/hooks/usePageScroll';

import { useHasUpdate } from './user-menu/account';

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
    match: (pathname) =>
      pathname === '/' ||
      ['/continue-watching', '/douban', '/live'].some((path) =>
        pathname.startsWith(path),
      ),
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
    match: (pathname) =>
      ['/me', '/u/', '/settings'].some((path) => pathname.startsWith(path)),
  },
];

const MobileBottomNav = () => {
  const pathname = usePathname() ?? '/';
  const prefetchRoute = useIntentPrefetch();
  const hasUpdate = useHasUpdate();

  return (
    <nav
      aria-label='主导航'
      className='fixed inset-x-0 bottom-0 z-[600] border-t border-gray-200/70 bg-gray-50/90 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/85 md:hidden'
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className='flex h-14 items-stretch'>
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const showDot = item.href === '/me' && hasUpdate;
          return (
            <li key={item.href} className='min-w-0 flex-1'>
              <Link
                href={item.href}
                prefetch={false}
                onClick={(event) => {
                  // 再次点击当前标签回到顶部，与原生应用一致
                  if (pathname === item.href) {
                    event.preventDefault();
                    scrollPageToTop();
                  }
                }}
                onFocus={() => prefetchRoute(item.href)}
                onTouchStart={() => prefetchRoute(item.href)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={`flex h-full w-full select-none flex-col items-center justify-center gap-0.5 transition-[color,transform] duration-150 active:scale-90 ${
                  active
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                <span className='relative'>
                  <item.icon
                    aria-hidden='true'
                    className='h-[22px] w-[22px]'
                    strokeWidth={active ? 2.25 : 1.75}
                    fill={active ? 'currentColor' : 'none'}
                    fillOpacity={active ? 0.16 : 0}
                  />
                  {showDot && (
                    <span className='absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-gray-50 dark:ring-gray-950' />
                  )}
                </span>
                <span
                  className={`text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}
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
