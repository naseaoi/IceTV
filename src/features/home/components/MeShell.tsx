'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';

import { MineProfileHeader } from './MineProfileHeader';

const ME_TABS = [
  { label: '概览', href: '/me' },
  { label: '收藏', href: '/me/favorites' },
  { label: '历史', href: '/me/history' },
  { label: '评价', href: '/me/reviews' },
];

// 「我的」各标签页共用外壳，放在 layout 中，切换标签时横幅不重新挂载
export function MeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/me';

  return (
    <PageLayout activePath='/me'>
      <div className={PAGE_CONTAINER_CLASS}>
        <MineProfileHeader />
        <nav
          aria-label='我的'
          className='flex gap-6 border-b border-gray-200/80 dark:border-white/[0.08]'
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
                    ? 'font-medium text-gray-900 dark:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
                {active && (
                  <span className='absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-500 dark:bg-brand-400' />
                )}
              </Link>
            );
          })}
        </nav>
        <div className='pb-10 pt-5 md:pt-6'>{children}</div>
      </div>
    </PageLayout>
  );
}
