'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  ListEmptySkeleton,
  ListEmptyState,
  ListLoadingState,
} from '@/components/ListState';

const LIBRARY_EMPTY_FRAME_CLASS =
  'flex flex-col items-center px-6 py-20 text-center';
const LIBRARY_EMPTY_STATE_CLASS = 'w-full';
const LIBRARY_EMPTY_DESCRIPTION_CLASS =
  'mt-1 max-w-xs text-sm text-gray-500 dark:text-gray-400';

export const LIBRARY_PILL_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-full bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200';

// 观看历史、继续观看等列表页的吸顶工具栏：编辑态与普通态共用同一条
export const LIBRARY_STICKY_TOOLBAR_CLASS =
  'z-20 -mx-4 mb-4 flex items-center gap-2 bg-gray-50 px-4 py-3 dark:bg-gray-950 sm:-mx-8 sm:px-8 md:sticky md:top-16 xl:-mx-12 xl:px-12';

export const LIBRARY_TOOLBAR_BUTTON_CLASS =
  'inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm text-gray-600 transition hover:bg-gray-900/[0.05] hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white';

export const LIBRARY_DANGER_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-full bg-red-500 px-4 text-sm font-medium text-white transition hover:bg-red-600 disabled:pointer-events-none disabled:opacity-40';

export function LibraryEmptySkeleton({
  action = true,
  description,
  loading = false,
}: {
  action?: boolean;
  description?: string;
  loading?: boolean;
}) {
  return (
    <div className={LIBRARY_EMPTY_FRAME_CLASS}>
      {loading ? (
        <ListLoadingState className={LIBRARY_EMPTY_STATE_CLASS} />
      ) : (
        <ListEmptySkeleton className={LIBRARY_EMPTY_STATE_CLASS} />
      )}
      {description && (
        <p
          aria-hidden='true'
          className={`${LIBRARY_EMPTY_DESCRIPTION_CLASS} relative`}
        >
          <span className='invisible'>{description}</span>
          <span className='skeleton absolute inset-0 rounded' />
        </p>
      )}
      {action && (
        <div
          aria-hidden='true'
          className='skeleton mt-5 h-9 w-28 rounded-full'
        />
      )}
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
    <div className={LIBRARY_EMPTY_FRAME_CLASS}>
      <ListEmptyState
        icon={<Icon />}
        label={title}
        className={LIBRARY_EMPTY_STATE_CLASS}
      />
      {description && (
        <p className={LIBRARY_EMPTY_DESCRIPTION_CLASS}>{description}</p>
      )}
      {action && <div className='mt-5'>{action}</div>}
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
