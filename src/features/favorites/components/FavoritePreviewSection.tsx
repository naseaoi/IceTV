'use client';

import { ChevronRight, Star } from 'lucide-react';
import Link from 'next/link';

import HomePosterCardSkeleton, {
  HOME_POSTER_CARD_CLASS,
} from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';
import { FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS } from '@/features/favorites/lib/card-layout';
import type { FavoriteItem } from '@/features/favorites/types';

const FAVORITE_PREVIEW_LIMIT = 20;

export function FavoritePreviewSection({
  items,
  loading,
  skeletonCount = 0,
}: {
  items: FavoriteItem[];
  loading: boolean;
  skeletonCount?: number;
}) {
  const previewItems = items.slice(0, FAVORITE_PREVIEW_LIMIT);

  return (
    <section className='mb-2'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
          <Star className='h-5 w-5 text-amber-500' />
          我的收藏
        </h2>
        {items.length > 0 && (
          <Link
            href='/me/favorites'
            className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          >
            查看更多
            <ChevronRight className='ml-1 h-4 w-4' />
          </Link>
        )}
      </div>

      {loading && skeletonCount > 0 && items.length === 0 ? (
        <ScrollableRow>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <HomePosterCardSkeleton key={index} />
          ))}
        </ScrollableRow>
      ) : previewItems.length > 0 ? (
        <ScrollableRow>
          {previewItems.map((item, index) => (
            <div key={item.id + item.source} className={HOME_POSTER_CARD_CLASS}>
              <VideoCard
                query={item.search_title}
                {...item}
                from='favorite'
                type={item.episodes > 1 ? 'tv' : ''}
                priority={index < 4}
              />
            </div>
          ))}
        </ScrollableRow>
      ) : (
        <div className='pb-3 sm:pb-6'>
          <div
            data-favorite-empty-state
            className={`flex w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400 ${FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS}`}
          >
            暂无收藏内容
          </div>
        </div>
      )}
    </section>
  );
}
