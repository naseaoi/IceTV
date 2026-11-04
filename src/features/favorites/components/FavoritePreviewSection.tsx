'use client';

import { LibraryBig } from 'lucide-react';
import Link from 'next/link';

import { HOME_POSTER_CARD_CLASS } from '@/components/poster-card-layout';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';
import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';
import type { FavoriteItem } from '@/features/favorites/types';
import { FAVORITE_PREVIEW_LIMIT } from '@/lib/favorites-count';

function FavoriteShelfEnd({ total }: { total: number }) {
  return (
    <div className={HOME_POSTER_CARD_CLASS}>
      <Link
        href='/me/favorites'
        className='group flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300/80 text-center transition hover:border-gray-400 hover:bg-gray-100/80 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.04]'
      >
        <LibraryBig
          aria-hidden='true'
          className='h-5 w-5 text-gray-400 transition group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-200'
        />
        <span className='text-xs text-gray-600 dark:text-gray-300 sm:text-sm'>
          全部收藏
          <span className='ml-1 tabular-nums text-gray-400 dark:text-gray-500'>
            {total}
          </span>
        </span>
      </Link>
    </div>
  );
}

export function FavoritePreviewSection({
  items,
  total,
  loading,
  skeletonCount = 0,
}: {
  items: FavoriteItem[];
  total: number;
  loading: boolean;
  skeletonCount?: number;
}) {
  if (loading && items.length === 0) {
    return <FavoritePreviewSkeleton count={skeletonCount} />;
  }

  if (items.length === 0) {
    return (
      <p
        data-favorite-empty-state
        className='py-6 text-sm text-gray-400 dark:text-gray-500'
      >
        还没有收藏
      </p>
    );
  }

  return (
    <ScrollableRow>
      {items.slice(0, FAVORITE_PREVIEW_LIMIT).map((item, index) => (
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
      <FavoriteShelfEnd total={total} />
    </ScrollableRow>
  );
}
