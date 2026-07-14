'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ConfirmModal from '@/components/modals/ConfirmModal';
import PageLayout from '@/components/PageLayout';
import {
  FAVORITE_GRID_CLASS,
  FavoriteGrid,
} from '@/features/favorites/components/FavoriteGrid';
import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import { HomeMineSwitch } from '@/features/home/components/HomeMineSwitch';

function FavoriteGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={FAVORITE_GRID_CLASS}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className='w-full sm:w-[180px]'>
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
  const favoriteCount =
    favoriteItems.length > 0
      ? favoriteItems.length
      : loading
        ? skeletonCount
        : 0;

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
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                {favoriteCount} 部收藏
              </span>
              {favoriteItems.length > 0 && (
                <button
                  className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  onClick={() => setShowClearConfirm(true)}
                >
                  清空
                </button>
              )}
            </div>
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
