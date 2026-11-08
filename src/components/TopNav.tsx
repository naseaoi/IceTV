'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';
import { useChannelNavigation } from '@/hooks/useChannelNavigation';
import { usePageScrolled } from '@/hooks/usePageScroll';
import {
  usePendingTarget,
  useSlidingIndicator,
} from '@/hooks/useSlidingIndicator';
import type { RuntimeConfig } from '@/lib/runtime-config';

import {
  type ChannelItem,
  getChannelItems,
  isNavItemActive,
} from './channel-nav';
import MessageBell from './messages/MessageBell';
import { PAGE_CONTAINER_CLASS } from './page-container';
import { useRuntimeConfig } from './RuntimeConfigProvider';
import SearchBox from './SearchBox';
import { SiteIcon } from './SiteIcon';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

const NAV_INDICATOR_WIDTH = 16;
const NAV_INDICATOR_CLASS =
  'h-[3px] rounded-full bg-brand-500 dark:bg-brand-400';

function getNavItems(runtimeConfig?: RuntimeConfig): ChannelItem[] {
  return [...getChannelItems(runtimeConfig), { label: '我的', href: '/me' }];
}

function NavSearch({
  initialQuery,
  onSearchPage,
  onFocus,
}: {
  initialQuery: string;
  onSearchPage: boolean;
  onFocus?: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);

  return (
    <SearchBox
      variant='nav'
      value={query}
      onValueChange={setQuery}
      onFocus={onFocus}
      autoFocus={onSearchPage && !initialQuery}
      // 搜索页无关键词时页面正文就是历史列表
      showHistory={!onSearchPage || Boolean(initialQuery)}
      className='mr-2 hidden lg:block'
      inputClassName='w-64 xl:w-80'
    />
  );
}

// 搜索页的顶栏输入框承接地址里的关键词；key 随关键词变化重置草稿
function SearchPageNavSearch() {
  const query = normalizeSearchQueryInput(useSearchParams().get('q') ?? '');
  return <NavSearch key={query} initialQuery={query} onSearchPage />;
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
  const pathname = usePathname() ?? '/';
  const runtimeConfig = useRuntimeConfig();
  const { siteName } = useSite();
  const { prefetchRoute, handleNavClick } = useChannelNavigation();
  const scrolled = usePageScrolled(8);

  const navItems = useMemo(() => getNavItems(runtimeConfig), [runtimeConfig]);
  const activeHref = navItems.find((item) =>
    isNavItemActive(item.href, pathname, activePath),
  )?.href;
  const { targetHref, markPending } = usePendingTarget(activeHref);
  const indicator = useSlidingIndicator<HTMLElement>(targetHref, {
    width: NAV_INDICATOR_WIDTH,
    memoryKey: 'top-nav',
  });
  const onSearchPage = pathname.startsWith('/search');
  const solid = !transparentAtTop || scrolled;

  // 页面带吸附在顶栏下方的子栏（data-nav-subbar）时，两者连成一块吸顶区，分隔线只留在子栏底部
  return (
    <header
      data-solid={solid}
      className='sticky top-0 z-40 hidden h-16 border-b border-transparent transition-[background-color,border-color] duration-300 data-[solid=true]:border-gray-200/70 data-[solid=true]:bg-gray-50 dark:data-[solid=true]:border-white/[0.06] dark:data-[solid=true]:bg-gray-950 md:block [body:has([data-nav-subbar])_&]:border-transparent dark:[body:has([data-nav-subbar])_&]:border-transparent'
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

        <nav
          ref={indicator.containerRef}
          className='relative flex min-w-0 items-center gap-0.5 lg:gap-1'
        >
          {navItems.map((item) => {
            const active = item.href === activeHref;
            const selected = item.href === targetHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onMouseEnter={() => prefetchRoute(item.href)}
                onFocus={() => prefetchRoute(item.href)}
                onClick={(event) => {
                  markPending(event, item.href);
                  handleNavClick(event, item.href);
                }}
                data-active={selected}
                data-indicator-target={selected || undefined}
                aria-current={active ? 'page' : undefined}
                className='relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[15px] text-gray-500 transition-colors hover:text-gray-900 data-[active=true]:font-medium data-[active=true]:text-gray-900 dark:text-gray-400 dark:hover:text-white dark:data-[active=true]:text-white lg:px-3'
              >
                {item.label}
                {selected && !indicator.indicatorProps && (
                  <span
                    className={`absolute inset-x-0 -bottom-[3px] mx-auto w-4 ${NAV_INDICATOR_CLASS}`}
                  />
                )}
              </Link>
            );
          })}
          {indicator.indicatorProps && (
            <span
              aria-hidden='true'
              className={`sliding-indicator ${NAV_INDICATOR_CLASS}`}
              {...indicator.indicatorProps}
            />
          )}
        </nav>

        <div className='ml-auto flex shrink-0 items-center gap-1'>
          {!onSearchPage && (
            <Link
              href='/search'
              aria-label='搜索'
              className='flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 lg:hidden'
            >
              <Search className='h-5 w-5' />
            </Link>
          )}
          {onSearchPage ? (
            <Suspense
              fallback={<NavSearch initialQuery='' onSearchPage={true} />}
            >
              <SearchPageNavSearch />
            </Suspense>
          ) : (
            <NavSearch
              initialQuery=''
              onSearchPage={false}
              onFocus={() => prefetchRoute('/search')}
            />
          )}
          <MessageBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
