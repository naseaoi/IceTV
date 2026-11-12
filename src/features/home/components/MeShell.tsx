'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import MessageBell from '@/components/messages/MessageBell';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { SettingsLink } from '@/components/SettingsLink';
import {
  usePendingTarget,
  useSlidingIndicator,
} from '@/hooks/useSlidingIndicator';

import { MineProfileHeader } from './MineProfileHeader';

const ME_TABS = [
  { label: '概览', href: '/me' },
  { label: '收藏', href: '/me/favorites' },
  { label: '片单', href: '/me/lists' },
  { label: '历史', href: '/me/history' },
  { label: '评价', href: '/me/reviews' },
];

const TAB_INDICATOR_CLASS =
  'h-[3px] rounded-full bg-brand-500 dark:bg-brand-400 md:h-0.5';

function isTabActive(href: string, pathname: string) {
  return href === '/me' ? pathname === '/me' : pathname.startsWith(href);
}

const STICKY_SURFACE_CLASS =
  'bg-gray-50 dark:bg-gray-950 md:bg-transparent md:dark:bg-transparent';

// 「我的」各标签页共用外壳，放在 layout 中，切换标签时横幅不重新挂载
export function MeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/me';
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  const activeHref = ME_TABS.find((tab) =>
    isTabActive(tab.href, pathname),
  )?.href;
  const { targetHref, markPending } = usePendingTarget(activeHref);
  const indicator = useSlidingIndicator<HTMLDivElement>(targetHref);

  return (
    <PageLayout activePath='/me' mobileHeader={false}>
      {/* 移动端无通用顶栏，状态栏区域单独垫底，标签栏吸顶时不与系统状态栏重叠 */}
      <div
        aria-hidden='true'
        className={`fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] md:hidden ${STICKY_SURFACE_CLASS}`}
      />
      <div className='relative'>
        {profileId && (
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-400 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)] dark:from-gray-700 dark:to-gray-900 dark:opacity-60 md:hidden'
          />
        )}
        <div
          className={`relative ${PAGE_CONTAINER_CLASS}`}
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <MineProfileHeader
            actions={
              <>
                <MessageBell className='text-current' />
                <SettingsLink />
              </>
            }
          />
        </div>
      </div>
      <nav
        aria-label='我的'
        className={`sticky top-[env(safe-area-inset-top)] z-30 md:static ${STICKY_SURFACE_CLASS}`}
      >
        <div
          ref={indicator.containerRef}
          className={`${PAGE_CONTAINER_CLASS} relative flex gap-7 border-b border-gray-200/80 dark:border-white/[0.08] md:gap-6`}
        >
          {ME_TABS.map((tab) => {
            const active = tab.href === activeHref;
            const selected = tab.href === targetHref;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={(event) => markPending(event, tab.href)}
                aria-current={active ? 'page' : undefined}
                data-indicator-target={selected || undefined}
                className={`relative -mb-px py-3 text-[15px] transition-colors ${
                  selected
                    ? 'font-semibold text-gray-900 dark:text-white md:font-medium'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
                {selected && !indicator.indicatorProps && (
                  <span
                    className={`absolute inset-x-1 bottom-0 md:inset-x-0 ${TAB_INDICATOR_CLASS}`}
                  />
                )}
              </Link>
            );
          })}
          {indicator.indicatorProps && (
            <span
              aria-hidden='true'
              className='sliding-indicator -mt-[3px] h-[3px] md:-mt-0.5 md:h-0.5'
              {...indicator.indicatorProps}
            >
              <span
                className={`mx-1 block h-full md:mx-0 ${TAB_INDICATOR_CLASS}`}
              />
            </span>
          )}
        </div>
      </nav>
      <div className={`${PAGE_CONTAINER_CLASS} pb-10 pt-5 md:pt-6`}>
        {children}
      </div>
    </PageLayout>
  );
}
