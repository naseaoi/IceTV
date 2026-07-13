'use client';

import VideoCard from '@/components/VideoCard';
import type { FavoriteItem } from '@/features/favorites/types';

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
    <div className='min-[480px]:grid-cols-4 grid grid-cols-3 justify-start gap-x-3 gap-y-14 px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:gap-y-20 sm:px-2'>
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
