'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import MessageBell from '@/components/messages/MessageBell';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { avatarGradient } from '@/components/ProfileAvatar';
import { SettingsLink } from '@/components/SettingsLink';

import { MineProfileHeader } from './MineProfileHeader';

const ME_TABS = [
  { label: '概览', href: '/me' },
  { label: '收藏', href: '/me/favorites' },
  { label: '历史', href: '/me/history' },
  { label: '评价', href: '/me/reviews' },
];

const STICKY_SURFACE_CLASS =
  'bg-gray-50/90 backdrop-blur-xl dark:bg-gray-950/85 md:bg-transparent md:backdrop-blur-none md:dark:bg-transparent';

// 「我的」各标签页共用外壳，放在 layout 中，切换标签时横幅不重新挂载
export function MeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/me';
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;

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
            className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)] dark:opacity-20 md:hidden ${avatarGradient(profileId)}`}
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
          className={`${PAGE_CONTAINER_CLASS} flex gap-7 border-b border-gray-200/80 dark:border-white/[0.08] md:gap-6`}
        >
          {ME_TABS.map((tab) => {
            const active =
              tab.href === '/me'
                ? pathname === '/me'
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative -mb-px py-3 text-[15px] transition-colors ${
                  active
                    ? 'font-semibold text-gray-900 dark:text-white md:font-medium'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
                {active && (
                  <span className='absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-brand-500 dark:bg-brand-400 md:inset-x-0 md:h-0.5' />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className={`${PAGE_CONTAINER_CLASS} pb-10 pt-5 md:pt-6`}>
        {children}
      </div>
    </PageLayout>
  );
}
