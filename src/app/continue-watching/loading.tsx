import { History } from 'lucide-react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import {
  CONTINUE_WATCHING_GRID_CLASS,
  CONTINUE_WATCHING_GRID_ITEM_CLASS,
} from '@/features/continue-watching/lib/layout';
import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function ContinueWatchingLoading() {
  const count = await getContinueWatchingSkeletonCount({
    cookieName: 'cw_page_count',
    limit: CONTINUE_WATCHING_PAGE_SIZE,
  });

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
              <div className='skeleton h-5 w-16 rounded' />
              <div className='skeleton h-5 w-7 rounded' />
            </div>
          </div>
          <div className={CONTINUE_WATCHING_GRID_CLASS}>
            {Array.from({ length: count || 8 }).map((_, index) => (
              <HomePosterCardSkeleton
                key={index}
                className={CONTINUE_WATCHING_GRID_ITEM_CLASS}
              />
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
