'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import SkeletonText from '@/components/SkeletonText';

const EMPTY_TITLE_TEXT_CLASS = 'mt-4 text-base font-medium';

export const LIBRARY_PILL_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-full bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200';

// 观看历史、继续观看等列表页的吸顶工具栏：编辑态与普通态共用同一条
export const LIBRARY_STICKY_TOOLBAR_CLASS =
  'z-20 -mx-4 mb-4 flex items-center gap-2 bg-gray-50 px-4 py-3 dark:bg-gray-950 sm:-mx-8 sm:px-8 md:sticky md:top-16 xl:-mx-12 xl:px-12';

export const LIBRARY_TOOLBAR_BUTTON_CLASS =
  'inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm text-gray-600 transition hover:bg-gray-900/[0.05] hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white';

export const LIBRARY_DANGER_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-full bg-red-500 px-4 text-sm font-medium text-white transition hover:bg-red-600 disabled:pointer-events-none disabled:opacity-40';

export function LibraryEmptySkeleton() {
  return (
    <div aria-hidden='true' className='flex flex-col items-center px-6 py-20'>
      <div className='skeleton h-14 w-14 rounded-2xl' />
      <SkeletonText
        className={EMPTY_TITLE_TEXT_CLASS}
        barClassName='h-4 w-28 rounded'
      />
      <div className='skeleton mt-5 h-9 w-28 rounded-full' />
    </div>
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
  description?: string;
  action: ReactNode;
}) {
  return (
    <div className='flex flex-col items-center px-6 py-20 text-center'>
      <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500'>
        <Icon aria-hidden='true' className='h-6 w-6' />
      </div>
      <p
        className={`${EMPTY_TITLE_TEXT_CLASS} text-gray-900 dark:text-gray-100`}
      >
        {title}
      </p>
      {description && (
        <p className='mt-1 max-w-xs text-sm text-gray-500 dark:text-gray-400'>
          {description}
        </p>
      )}
      <div className='mt-5'>{action}</div>
    </div>
  );
}

// 「我的」下属内容库页共用内容框架，外壳（横幅与标签）由 /me 的 layout 提供；
// loading.tsx 与客户端加载态都渲染它，冷启动切换时布局不跳动
export function LibraryPageFrame({
  title,
  subtitle,
  action,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <h2 className='sr-only'>{title}</h2>
      {toolbar && (
        <div className={subtitle || action ? 'mb-4' : 'mb-5'}>{toolbar}</div>
      )}
      {(subtitle || action) && (
        <div className='mb-5 flex min-h-9 items-center justify-between gap-4'>
          <p className='min-w-0 text-sm text-gray-500 dark:text-gray-400'>
            {subtitle}
          </p>
          {action}
        </div>
      )}
      {children}
    </>
  );
}
