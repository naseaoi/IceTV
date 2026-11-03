'use client';

import Link from 'next/link';

import CoverImage from '@/components/CoverImage';
import {
  POSTER_GRID_CLASS,
  POSTER_VIRTUAL_GRID_LAYOUT,
} from '@/components/poster-grid-layout';
import VideoCard from '@/components/VideoCard';
import { VirtualizedGrid } from '@/components/VirtualizedGrid';
import type { FavoriteItem } from '@/features/favorites/types';

export function FavoriteGrid({
  items,
  emptyText = '暂无收藏内容',
  readOnly = false,
  virtualized = false,
}: {
  items: FavoriteItem[];
  emptyText?: string;
  readOnly?: boolean;
  virtualized?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div
        data-favorite-empty-state
        className='py-5 text-center text-gray-500 dark:text-gray-400'
      >
        {emptyText}
      </div>
    );
  }

  if (virtualized && !readOnly) {
    return (
      <VirtualizedGrid
        items={items}
        getKey={(item) => `${item.source}+${item.id}`}
        renderItem={(item) => <FavoriteVideoCard item={item} />}
        layout={POSTER_VIRTUAL_GRID_LAYOUT}
        fallbackClassName={POSTER_GRID_CLASS}
        fallbackCount={48}
      />
    );
  }

  return (
    <div className={POSTER_GRID_CLASS}>
      {items.map((item) => (
        <div key={item.id + item.source} className='w-full'>
          {readOnly ? (
            <Link
              href={`/play?${new URLSearchParams({ source: item.source, id: item.id, title: item.title, ...(item.year ? { year: item.year } : {}), ...(item.search_title ? { stitle: item.search_title } : {}) })}`}
              className='block'
            >
              <div className='relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800'>
                <CoverImage src={item.poster} alt={item.title} sizes='180px' />
              </div>
              <h3 className='mt-2 truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                {item.title}
              </h3>
              <p className='mt-1 text-xs text-gray-500'>
                {[item.year === 'unknown' ? '' : item.year, item.source_name]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </Link>
          ) : (
            <FavoriteVideoCard item={item} />
          )}
        </div>
      ))}
    </div>
  );
}

function FavoriteVideoCard({ item }: { item: FavoriteItem }) {
  return (
    <VideoCard
      query={item.search_title}
      {...item}
      from='favorite'
      type={item.episodes > 1 ? 'tv' : ''}
    />
  );
}
