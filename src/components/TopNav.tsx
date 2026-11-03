'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { FormEvent, MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useIntentPrefetch } from '@/hooks/useIntentPrefetch';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { getCustomCategoryLabel, RuntimeConfig } from '@/lib/runtime-config';

import MessageBell from './messages/MessageBell';
import { PAGE_CONTAINER_CLASS } from './page-container';
import { useRuntimeConfig } from './RuntimeConfigProvider';
import { SiteIcon } from './SiteIcon';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

const LIVE_ROUTE = '/live';

type NavItem = { label: string; href: string };

function getNavItems(runtimeConfig?: RuntimeConfig): NavItem[] {
  const items: NavItem[] = [
    { label: '首页', href: '/' },
    { label: '电影', href: '/douban?type=movie' },
    { label: '剧集', href: '/douban?type=tv' },
    { label: '动漫', href: '/douban?type=anime' },
    { label: '综艺', href: '/douban?type=show' },
  ];

  if ((runtimeConfig?.CUSTOM_CATEGORIES?.length ?? 0) > 0) {
    items.push({
      label: getCustomCategoryLabel(runtimeConfig),
      href: '/douban?type=custom',
    });
  }
  if (runtimeConfig?.ENABLE_LIVE_ENTRY) {
    items.push({ label: '直播', href: LIVE_ROUTE });
  }
  items.push({ label: '我的', href: '/me' });

  return items;
}

// 分类页的筛选参数不在 pathname 中，靠页面传入的 activePath 区分类型
function isNavItemActive(
  href: string,
  pathname: string,
  activePath: string,
): boolean {
  if (href === '/')
    return pathname === '/' || pathname === '/continue-watching';
  if (href.startsWith('/douban')) {
    const type = href.split('type=')[1];
    return pathname === '/douban' && activePath.includes(`type=${type}`);
  }
  if (href === '/me') {
    return pathname.startsWith('/me') || pathname.startsWith('/u/');
  }
  return pathname.startsWith(href);
}

function getPageScrollTop(): number {
  return (
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

function usePageScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(getPageScrollTop() > threshold);
    const targets = [window, document.documentElement, document.body];
    update();
    targets.forEach((target) =>
      target.addEventListener('scroll', update, { passive: true }),
    );
    return () =>
      targets.forEach((target) => target.removeEventListener('scroll', update));
  }, [threshold]);

  return scrolled;
}

interface TopNavProps {
  activePath: string;
  // 首页首屏精选铺在顶栏下方，未滚动时顶栏保持透明
  transparentAtTop?: boolean;
}

export default function TopNav({
  activePath,
  transparentAtTop = false,
}: TopNavProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const runtimeConfig = useRuntimeConfig();
  const { siteName } = useSite();
  const prefetchIntent = useIntentPrefetch();
  const scrolled = usePageScrolled(8);
  const [query, setQuery] = useState('');

  const navItems = useMemo(() => getNavItems(runtimeConfig), [runtimeConfig]);
  const showSearch = !pathname.startsWith('/search');
  const solid = !transparentAtTop || scrolled;

  const prefetchRoute = useCallback(
    (href: string) => {
      if (href !== LIVE_ROUTE) prefetchIntent(href);
    },
    [prefetchIntent],
  );

  const handleNavClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        href !== LIVE_ROUTE ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const returnTo = getCurrentNavigationPath();
      if (returnTo.startsWith(LIVE_ROUTE)) return;

      event.preventDefault();
      router.push(withReturnTo(href, returnTo));
    },
    [router],
  );

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    setQuery('');
  };

  return (
    <header
      data-solid={solid}
      className='sticky top-0 z-40 hidden h-16 border-b border-transparent transition-[background-color,border-color] duration-300 data-[solid=true]:border-gray-200/70 data-[solid=true]:bg-gray-50/85 data-[solid=true]:backdrop-blur-xl dark:data-[solid=true]:border-white/[0.06] dark:data-[solid=true]:bg-gray-950/80 md:block'
    >
      <div
        className={`${PAGE_CONTAINER_CLASS} flex h-full items-center gap-5 lg:gap-8`}
      >
        <Link
          href='/'
          className='flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80'
        >
          <span className='h-8 w-8'>
            <SiteIcon />
          </span>
          <span className='text-lg font-semibold tracking-tight text-gray-900 dark:text-white'>
            {siteName}
          </span>
        </Link>

        <nav className='flex min-w-0 items-center gap-0.5 lg:gap-1'>
          {navItems.map((item) => {
            const active = isNavItemActive(item.href, pathname, activePath);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onMouseEnter={() => prefetchRoute(item.href)}
                onFocus={() => prefetchRoute(item.href)}
                onClick={(event) => handleNavClick(event, item.href)}
                data-active={active}
                aria-current={active ? 'page' : undefined}
                className='relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[15px] text-gray-500 transition-colors hover:text-gray-900 data-[active=true]:font-medium data-[active=true]:text-gray-900 dark:text-gray-400 dark:hover:text-white dark:data-[active=true]:text-white lg:px-3'
              >
                {item.label}
                {active && (
                  <span className='absolute inset-x-0 -bottom-[3px] mx-auto h-[3px] w-4 rounded-full bg-brand-500 dark:bg-brand-400' />
                )}
              </Link>
            );
          })}
        </nav>

        <div className='ml-auto flex shrink-0 items-center gap-1'>
          {showSearch && (
            <Link
              href='/search'
              aria-label='搜索'
              className='flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 lg:hidden'
            >
              <Search className='h-5 w-5' />
            </Link>
          )}
          {showSearch && (
            <form
              onSubmit={handleSearch}
              role='search'
              className='mr-2 hidden lg:block'
            >
              <label className='group relative flex items-center'>
                <Search className='pointer-events-none absolute left-3 h-4 w-4 text-gray-400 dark:text-gray-500' />
                <input
                  type='search'
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => prefetchRoute('/search')}
                  placeholder='搜索影片'
                  aria-label='搜索影片'
                  className='h-9 w-52 rounded-full border-0 bg-gray-900/[0.06] py-0 pl-9 pr-3 text-sm text-gray-900 transition-[width,background-color] duration-300 placeholder:text-gray-400 focus:w-72 focus:bg-gray-900/[0.09] focus:ring-0 dark:bg-white/[0.07] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-white/[0.11]'
                />
              </label>
            </form>
          )}
          <MessageBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
