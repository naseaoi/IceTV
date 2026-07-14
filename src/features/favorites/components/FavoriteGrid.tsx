'use client';

import { POSTER_GRID_BASE_CLASS } from '@/components/poster-grid-layout';
import VideoCard from '@/components/VideoCard';
import type { FavoriteItem } from '@/features/favorites/types';

export const FAVORITE_GRID_CLASS = `${POSTER_GRID_BASE_CLASS} px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:px-2`;

export function FavoriteGrid({
  items,
  emptyText = '暂无收藏内容',
}: {
  items: FavoriteItem[];
  emptyText?: string;
}) {
  if (items.length === 0) {
    return (
      <div className='py-8 text-center text-gray-500 dark:text-gray-400'>
        {emptyText}
      </div>
    );
  }

  return (
    <div className={FAVORITE_GRID_CLASS}>
      {items.map((item) => (
        <div key={item.id + item.source} className='w-full sm:w-[180px]'>
          <VideoCard
            query={item.search_title}
            {...item}
            from='favorite'
            type={item.episodes > 1 ? 'tv' : ''}
          />
        </div>
      ))}
    </div>
  );
}
