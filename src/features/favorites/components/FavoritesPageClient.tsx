'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

import PageLayout from '@/components/PageLayout';
import ConfirmModal from '@/components/modals/ConfirmModal';
import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { FavoriteGrid } from '@/features/favorites/components/FavoriteGrid';
import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import { HomeMineSwitch } from '@/features/home/components/HomeMineSwitch';

function FavoriteGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className='grid grid-cols-3 justify-start gap-x-2 gap-y-14 px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:gap-y-20 sm:px-2'>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className='w-24 sm:w-[180px]'>
          <HomePosterCardSkeleton withSubtitle />
        </div>
      ))}
    </div>
  );
}

export function FavoritesPageClient({
  favoriteSkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
}) {
  const { favoriteItems, loading, skeletonCount, clearFavorites } =
    useFavoriteItems(true, favoriteSkeletonCount);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <PageLayout activePath='/'>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 flex justify-center'>
          <HomeMineSwitch active='mine' />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div className='mb-6 flex items-center justify-between'>
            <h1 className='flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100'>
              <Star className='h-6 w-6 text-amber-500' />
              我的收藏
            </h1>
            {favoriteItems.length > 0 && (
              <button
                className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                onClick={() => setShowClearConfirm(true)}
              >
                清空
              </button>
            )}
          </div>

          {loading && skeletonCount > 0 && favoriteItems.length === 0 ? (
            <FavoriteGridSkeleton count={skeletonCount} />
          ) : (
            <FavoriteGrid items={favoriteItems} />
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        title='确认清空收藏夹？'
        message='该操作会删除所有收藏内容，删除后无法恢复。'
        danger
        cancelText='再想想'
        confirmText='确认清空'
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={async () => {
          await clearFavorites();
          setShowClearConfirm(false);
        }}
      />
    </PageLayout>
  );
}
