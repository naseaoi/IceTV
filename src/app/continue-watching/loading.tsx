import { History } from 'lucide-react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { POSTER_GRID_BASE_CLASS } from '@/components/poster-grid-layout';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function ContinueWatchingLoading() {
  const count = await getContinueWatchingSkeletonCount();

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
            <div className='skeleton h-5 w-16 rounded' />
          </div>
          <div
            className={`${POSTER_GRID_BASE_CLASS} px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:px-2`}
          >
            {Array.from({ length: count || 8 }).map((_, index) => (
              <HomePosterCardSkeleton
                key={index}
                className='w-full sm:w-[180px]'
              />
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
