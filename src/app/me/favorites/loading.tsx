import { Star } from 'lucide-react';

import PageLayout from '@/components/PageLayout';
import { FavoriteGridSkeleton } from '@/features/favorites/components/FavoriteGridSkeleton';
import { HomeMineSwitch } from '@/features/home/components/HomeMineSwitch';

export default function FavoritesLoading() {
  return (
    <PageLayout
      activePath='/'
      mobileHeader={{ title: '我的收藏', showBack: true }}
    >
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 hidden justify-center md:flex'>
          <HomeMineSwitch active='mine' />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div className='mb-6 flex items-center justify-between'>
            <h1 className='hidden items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100 sm:flex'>
              <Star className='h-6 w-6 text-amber-500' />
              我的收藏
            </h1>
            <div className='flex flex-1 items-center justify-between gap-4 sm:flex-none sm:justify-end'>
              <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            </div>
          </div>

          <FavoriteGridSkeleton count={6} />
        </div>
      </div>
    </PageLayout>
  );
}
