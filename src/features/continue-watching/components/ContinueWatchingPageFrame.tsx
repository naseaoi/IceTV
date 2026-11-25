'use client';

import type { ReactNode } from 'react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';
import {
  LIBRARY_STICKY_TOOLBAR_CLASS,
  LibraryEmptySkeleton,
} from '@/components/LibraryPage';
import { LibraryFilterChip } from '@/components/LibraryToolbar';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { CONTINUE_WATCHING_GRID_CLASS } from '@/features/continue-watching/lib/layout';

// 路由骨架与真实页面共用外壳，切换时标题、工具栏与网格位置不跳动
export function ContinueWatchingPageFrame({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageLayout
      activePath='/continue-watching'
      mobileHeader={{ title: '继续观看', showBack: true }}
    >
      <div className='pb-10 pt-1 md:pt-5'>
        <div className={PAGE_CONTAINER_CLASS}>
          {/* 标题与筛选同一行并一起吸顶；窄屏标题在顶栏，这一行只剩筛选 */}
          <div className={LIBRARY_STICKY_TOOLBAR_CLASS}>
            <h1 className='hidden shrink-0 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-50 md:mr-4 md:block'>
              继续观看
            </h1>
            {toolbar}
          </div>
          {children}
        </div>
      </div>
    </PageLayout>
  );
}

export function ContinueWatchingGridSkeleton({ count }: { count: number }) {
  if (count === 0) return <LibraryEmptySkeleton />;
  return (
    <div aria-hidden='true' className={CONTINUE_WATCHING_GRID_CLASS}>
      {Array.from({ length: count }, (_, index) => (
        <ContinueWatchingCardSkeleton key={index} fluid />
      ))}
    </div>
  );
}

export function ContinueWatchingToolbarSkeleton({ count }: { count: number }) {
  return (
    <>
      <div aria-hidden='true' inert className='flex'>
        <LibraryFilterChip
          label='全部'
          count={0}
          active
          loading
          onClick={() => undefined}
        />
      </div>
      {count > 0 && (
        <div
          aria-hidden='true'
          className='skeleton ml-auto h-9 w-[60px] shrink-0 rounded-full'
        />
      )}
    </>
  );
}
