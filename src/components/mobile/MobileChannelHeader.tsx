'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useMemo, useRef } from 'react';

import { getChannelItems, isNavItemActive } from '@/components/channel-nav';
import MessageBell from '@/components/messages/MessageBell';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import { SiteIcon } from '@/components/SiteIcon';
import { useChannelNavigation } from '@/hooks/useChannelNavigation';
import { useHideOnScrollDown, usePageScrolled } from '@/hooks/usePageScroll';

// 首屏精选的大半高度滚过后再转实底，避免刚开始滚动就盖住海报
const SOLID_AFTER_PX = 160;

interface MobileChannelHeaderProps {
  activePath: string;
  transparentAtTop: boolean;
}

export default function MobileChannelHeader({
  activePath,
  transparentAtTop,
}: MobileChannelHeaderProps) {
  const pathname = usePathname() ?? '/';
  const runtimeConfig = useRuntimeConfig();
  const { prefetchRoute, handleNavClick } = useChannelNavigation();
  const channels = useMemo(
    () => getChannelItems(runtimeConfig),
    [runtimeConfig],
  );
  const scrolled = usePageScrolled(SOLID_AFTER_PX);
  const collapsed = useHideOnScrollDown(true);
  const solid = !transparentAtTop || scrolled;
  const stripRef = useRef<HTMLDivElement>(null);
  const activeHref = channels.find((item) =>
    isNavItemActive(item.href, pathname, activePath),
  )?.href;

  // 切到靠后的频道时把选中项滚进可视区
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !active) return;
    const target =
      active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollLeft = Math.max(0, target);
  }, [activeHref]);

  return (
    <header
      data-solid={solid}
      className={`group fixed inset-x-0 top-0 z-[999] w-full border-b transition-[transform,background-color,border-color] duration-300 ease-out md:hidden ${
        solid
          ? 'border-gray-200/70 bg-gray-50/90 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/85'
          : 'border-transparent'
      } ${collapsed ? '-translate-y-12' : 'translate-y-0'}`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className={`flex h-12 items-center gap-3 pl-4 pr-2 transition-opacity duration-200 ${
          collapsed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <Link href='/' aria-label='首页' className='h-7 w-7 shrink-0'>
          <SiteIcon />
        </Link>
        <Link
          href='/search'
          prefetch={false}
          onTouchStart={() => prefetchRoute('/search')}
          className='flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/15 px-3.5 text-sm text-white/75 transition-colors group-data-[solid=true]:bg-gray-900/[0.06] group-data-[solid=true]:text-gray-500 dark:group-data-[solid=true]:bg-white/[0.08] dark:group-data-[solid=true]:text-gray-400'
        >
          <Search aria-hidden='true' className='h-4 w-4 shrink-0' />
          <span className='truncate'>搜索影片</span>
        </Link>
        <MessageBell className='text-white group-data-[solid=true]:text-gray-700 dark:group-data-[solid=true]:text-gray-200' />
      </div>

      <nav
        ref={stripRef}
        aria-label='频道'
        className='scrollbar-hide flex h-10 items-center gap-5 overflow-x-auto px-4'
      >
        {channels.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onTouchStart={() => prefetchRoute(item.href)}
              onClick={(event) => handleNavClick(event, item.href)}
              aria-current={active ? 'page' : undefined}
              className={`relative shrink-0 whitespace-nowrap py-2 transition-colors ${
                active
                  ? 'text-[17px] font-semibold text-white group-data-[solid=true]:text-gray-900 dark:group-data-[solid=true]:text-white'
                  : 'text-[15px] text-white/70 group-data-[solid=true]:text-gray-500 dark:group-data-[solid=true]:text-gray-400'
              }`}
            >
              {item.label}
              {active && (
                <span className='absolute inset-x-0 bottom-0.5 mx-auto h-[3px] w-4 rounded-full bg-brand-400 group-data-[solid=true]:bg-brand-500 dark:group-data-[solid=true]:bg-brand-400' />
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
