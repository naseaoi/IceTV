'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export const LIBRARY_PILL_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-full bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200';

export function LibrarySubtitleSkeleton() {
  return (
    <span className='skeleton inline-block h-4 w-32 rounded align-middle' />
  );
}

export function LibraryEmptySkeleton() {
  return (
    <div aria-hidden='true' className='flex flex-col items-center px-6 py-20'>
      <div className='skeleton h-14 w-14 rounded-2xl' />
      <div className='mt-4 flex h-6 items-center'>
        <div className='skeleton h-4 w-28 rounded' />
      </div>
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
      <p className='mt-4 text-base font-medium text-gray-900 dark:text-gray-100'>
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
  subtitle: ReactNode;
  action?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <h2 className='sr-only'>{title}</h2>
      {toolbar && <div className='mb-4'>{toolbar}</div>}
      <div className='mb-5 flex min-h-9 items-center justify-between gap-4'>
        <p className='min-w-0 text-sm text-gray-500 dark:text-gray-400'>
          {subtitle}
        </p>
        {action}
      </div>
      {children}
    </>
  );
}
