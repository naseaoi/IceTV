'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import PageLayout from '@/components/PageLayout';
import { HomeMineSwitch } from '@/features/home/components/HomeMineSwitch';

export const LIBRARY_PILL_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-full bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200';

export function LibrarySubtitleSkeleton() {
  return (
    <span className='inline-block h-4 w-32 animate-pulse rounded bg-gray-200 align-middle dark:bg-white/10' />
  );
}

export function LibraryEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className='flex flex-col items-center px-6 py-20 text-center'>
      <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500'>
        <Icon aria-hidden='true' className='h-6 w-6' />
      </div>
      <p className='mt-4 text-base font-medium text-gray-900 dark:text-gray-100'>
        {title}
      </p>
      <p className='mt-1 max-w-xs text-sm text-gray-500 dark:text-gray-400'>
        {description}
      </p>
      <div className='mt-5'>{action}</div>
    </div>
  );
}

// 「我的」下属内容库页共用外框；loading.tsx 与客户端加载态都渲染它，冷启动切换时布局不跳动
export function LibraryPageFrame({
  title,
  subtitle,
  action,
  toolbar,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  action?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageLayout activePath='/' mobileHeader={{ title, showBack: true }}>
      <div className='overflow-visible px-3 pb-8 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-6 hidden justify-center md:flex'>
          <HomeMineSwitch active='mine' />
        </div>

        <div className='max-sm:max-w-none mx-auto max-w-[95%]'>
          <header className='mb-5 flex min-h-9 items-end justify-between gap-4'>
            <div className='min-w-0'>
              <h1 className='hidden text-[1.75rem] font-semibold leading-tight tracking-tight text-gray-900 dark:text-gray-50 sm:block'>
                {title}
              </h1>
              <p className='text-sm text-gray-500 dark:text-gray-400 sm:mt-1'>
                {subtitle}
              </p>
            </div>
            {action}
          </header>

          {toolbar && <div className='mb-6'>{toolbar}</div>}

          {children}
        </div>
      </div>
    </PageLayout>
  );
}
