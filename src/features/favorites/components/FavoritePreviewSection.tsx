'use client';

import { ChevronRight, LibraryBig, Star } from 'lucide-react';
import Link from 'next/link';

import HomePosterCardSkeleton, {
  HOME_POSTER_CARD_CLASS,
} from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';
import { FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS } from '@/features/favorites/lib/card-layout';
import type { FavoriteItem } from '@/features/favorites/types';

const FAVORITE_PREVIEW_LIMIT = 20;
const SPARSE_SHELF_LIMIT = 6;

// flex-1 吃掉行尾剩余宽度：收藏少时补满空白，收藏多时退化为海报宽的末尾入口
function FavoriteShelfEnd({ total }: { total: number }) {
  return (
    <div className='flex min-w-[25vw] flex-1 sm:min-w-[180px]'>
      <Link
        href='/me/favorites'
        className='group flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300/80 bg-gray-50/60 px-3 text-center transition hover:border-gray-400 hover:bg-gray-100/80 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20 dark:hover:bg-white/[0.05] sm:aspect-auto sm:h-[270px] sm:gap-3'
      >
        <span className='flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm ring-1 ring-black/5 transition group-hover:text-gray-900 dark:bg-white/10 dark:text-gray-300 dark:shadow-none dark:ring-0 dark:group-hover:text-white sm:h-11 sm:w-11'>
          <LibraryBig aria-hidden='true' className='h-4 w-4 sm:h-5 sm:w-5' />
        </span>
        <span className='text-xs font-medium text-gray-900 dark:text-gray-100 sm:text-sm'>
          全部收藏
          <span className='ml-1 font-normal tabular-nums text-gray-500 dark:text-gray-400'>
            {total}
          </span>
        </span>
        {total <= SPARSE_SHELF_LIMIT && (
          <span className='hidden max-w-[15rem] text-xs leading-5 text-gray-500 dark:text-gray-400 sm:block'>
            点亮卡片上的爱心，收藏喜欢的作品
          </span>
        )}
      </Link>
    </div>
  );
}

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
          <FavoriteShelfEnd total={items.length} />
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
