import { History } from 'lucide-react';

import PageLayout from '@/components/PageLayout';
import { POSTER_GRID_BASE_CLASS } from '@/components/poster-grid-layout';
import { HomeMineSwitch } from '@/features/home/components/HomeMineSwitch';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function ContinueWatchingLoading() {
  const count = await getContinueWatchingSkeletonCount();

  return (
    <PageLayout
      activePath='/'
      mobileHeader={{ title: '继续观看', showBack: true }}
    >
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 hidden justify-center md:flex'>
          <HomeMineSwitch active='home' />
        </div>
        <div className='mx-auto max-w-[95%]'>
          <div className='mb-6 flex items-center justify-between'>
            <h1 className='hidden items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100 sm:flex'>
              <History className='h-6 w-6 text-orange-500' />
              继续观看
            </h1>
            <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
          <div
            className={`${POSTER_GRID_BASE_CLASS} px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:px-2`}
          >
            {Array.from({ length: count || 8 }).map((_, index) => (
              <div
                key={index}
                className='aspect-[2/3] w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800 sm:w-[180px]'
              />
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
