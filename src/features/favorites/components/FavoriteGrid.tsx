'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';

import CoverImage from '@/components/CoverImage';
import { POSTER_CARD_COVER_CLASS } from '@/components/poster-card-layout';
import {
  POSTER_GRID_CLASS,
  POSTER_VIRTUAL_GRID_LAYOUT,
} from '@/components/poster-grid-layout';
import RatingBadge from '@/components/RatingBadge';
import SkeletonText from '@/components/SkeletonText';
import VideoCard from '@/components/VideoCard';
import { VirtualizedGrid } from '@/components/VirtualizedGrid';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
import type { FavoriteItem } from '@/features/favorites/types';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import { FAVORITE_RENDER_CHUNK } from '@/lib/favorites-count';

export function FavoriteGrid({
  items,
  emptyText = '暂无收藏内容',
  readOnly = false,
  virtualized = false,
  selection,
}: {
  items: FavoriteItem[];
  emptyText?: string;
  readOnly?: boolean;
  virtualized?: boolean;
  selection?: FavoriteGridSelection;
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
        renderItem={(item) => (
          <FavoriteVideoCard item={item} selection={selection} />
        )}
        layout={POSTER_VIRTUAL_GRID_LAYOUT}
        fallbackClassName={POSTER_GRID_CLASS}
        fallbackCount={FAVORITE_RENDER_CHUNK}
      />
    );
  }

  return (
    <div className={POSTER_GRID_CLASS}>
      {items.map((item) => (
        <div key={item.id + item.source} className='w-full'>
          {readOnly ? (
            <ReadOnlyFavoriteCard item={item} />
          ) : (
            <FavoriteVideoCard item={item} selection={selection} />
          )}
        </div>
      ))}
    </div>
  );
}

export interface FavoriteGridSelection {
  isSelected: (key: string) => boolean;
  onToggle: (key: string) => void;
}

function FavoriteVideoCard({
  item,
  selection,
}: {
  item: FavoriteItem;
  selection?: FavoriteGridSelection;
}) {
  const card = (
    <VideoCard
      query={item.search_title}
      {...item}
      from='favorite'
      type={item.episodes > 1 ? 'tv' : ''}
    />
  );
  if (!selection) return card;
  const key = `${item.source}+${item.id}`;
  const selected = selection.isSelected(key);
  return (
    <div className='relative'>
      {card}
      <button
        type='button'
        role='checkbox'
        aria-checked={selected}
        aria-label={item.title}
        onClick={() => selection.onToggle(key)}
        className='absolute inset-0 z-30 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
      >
        <span
          aria-hidden='true'
          className={`absolute inset-x-0 top-0 ${POSTER_CARD_COVER_CLASS} transition ${
            selected
              ? 'bg-brand-500/20 ring-2 ring-inset ring-brand-500'
              : 'bg-black/10 dark:bg-black/25'
          }`}
        >
          <span
            className={`absolute bottom-2.5 right-2 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition ${
              selected
                ? 'bg-brand-500 text-white'
                : 'bg-black/30 text-transparent ring-[1.5px] ring-inset ring-white/90 backdrop-blur-sm'
            }`}
          >
            <Check className='h-3.5 w-3.5' strokeWidth={3} />
          </span>
        </span>
      </button>
    </div>
  );
}

function readOnlyPlayUrl(item: FavoriteItem) {
  const year: Record<string, string> =
    item.year && item.year !== 'unknown' ? { year: item.year } : {};
  // 目录收藏没有播放源，按标题搜索起播
  if (isCatalogFavoriteSource(item.source)) {
    return `/play?${new URLSearchParams({ title: item.title, ...year })}`;
  }
  return `/play?${new URLSearchParams({
    source: item.source,
    id: item.id,
    title: item.title,
    ...year,
    ...(item.search_title ? { stitle: item.search_title } : {}),
  })}`;
}

// 只读卡片与其骨架共用几何类，改动时两侧同步
const READ_ONLY_COVER_CLASS = 'aspect-[2/3] rounded-xl';
const READ_ONLY_TITLE_CLASS = 'mt-2 text-sm';
const READ_ONLY_META_CLASS = 'mt-1 text-xs';

export function ReadOnlyFavoriteGridSkeleton({ count }: { count: number }) {
  return (
    <div className={POSTER_GRID_CLASS} role='status' aria-label='加载中'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className={`skeleton ${READ_ONLY_COVER_CLASS}`} />
          <SkeletonText className={READ_ONLY_TITLE_CLASS} />
          <SkeletonText
            className={READ_ONLY_META_CLASS}
            barClassName='h-3 w-1/2 rounded'
          />
        </div>
      ))}
    </div>
  );
}

function ReadOnlyFavoriteCard({ item }: { item: FavoriteItem }) {
  const status = WATCH_STATUS_OPTIONS.find(
    (option) => option.value === item.watchStatus,
  );
  return (
    <Link href={readOnlyPlayUrl(item)} className='group block'>
      <div
        className={`relative overflow-hidden bg-gray-100 dark:bg-gray-800 ${READ_ONLY_COVER_CLASS}`}
      >
        <CoverImage src={item.poster} alt={item.title} sizes='180px' />
        {status && (
          <span className='absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-1 text-xs font-medium leading-none text-white shadow-sm ring-1 ring-inset ring-white/10 backdrop-blur-md'>
            {status.label}
          </span>
        )}
        {item.myRating !== undefined && (
          <RatingBadge
            value={item.myRating}
            variant='overlay'
            label='评分'
            className='absolute bottom-2 left-2 px-2 py-1'
          />
        )}
      </div>
      <h3
        className={`${READ_ONLY_TITLE_CLASS} truncate font-medium text-gray-900 transition group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
      >
        {item.title}
      </h3>
      <p className={`${READ_ONLY_META_CLASS} truncate text-gray-500`}>
        {[item.year === 'unknown' ? '' : item.year, item.source_name]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </Link>
  );
}
