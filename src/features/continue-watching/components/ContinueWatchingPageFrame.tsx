import { History } from 'lucide-react';
import type { ReactNode } from 'react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import SkeletonText from '@/components/SkeletonText';
import {
  CONTINUE_WATCHING_EMPTY_CLASS,
  CONTINUE_WATCHING_GRID_CLASS,
  CONTINUE_WATCHING_GRID_ITEM_CLASS,
} from '@/features/continue-watching/lib/layout';

// 路由骨架与真实页面共用外壳，total 为 null 时显示计数占位
export function ContinueWatchingPageFrame({
  total,
  action,
  children,
}: {
  total: number | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageLayout
      activePath='/'
      mobileHeader={{ title: '继续观看', showBack: true }}
    >
      <div className='overflow-visible pb-2 pt-4 md:pt-8'>
        <div className={PAGE_CONTAINER_CLASS}>
          <div className='mb-6 flex items-center justify-between'>
            <h1 className='hidden items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100 sm:flex'>
              <History className='h-6 w-6 text-orange-500' />
              继续观看
            </h1>
            <div className='flex flex-1 items-center justify-between gap-4 sm:flex-none sm:justify-end'>
              {total === null ? (
                <SkeletonText
                  className='text-sm'
                  barClassName='h-4 w-16 rounded'
                />
              ) : (
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  {total} 部记录
                </span>
              )}
              {action}
            </div>
          </div>
          {children}
        </div>
      </div>
    </PageLayout>
  );
}

export function ContinueWatchingGridSkeleton({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div
        aria-hidden='true'
        className={`flex justify-center ${CONTINUE_WATCHING_EMPTY_CLASS}`}
      >
        <SkeletonText barClassName='h-4 w-32 rounded' />
      </div>
    );
  }
  return (
    <div className={CONTINUE_WATCHING_GRID_CLASS}>
      {Array.from({ length: count }).map((_, index) => (
        <HomePosterCardSkeleton
          key={index}
          className={CONTINUE_WATCHING_GRID_ITEM_CLASS}
        />
      ))}
    </div>
  );
}
