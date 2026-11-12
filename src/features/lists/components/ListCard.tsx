'use client';

import { Clapperboard, Lock } from 'lucide-react';
import Link from 'next/link';

import CoverImage from '@/components/CoverImage';
import SkeletonText from '@/components/SkeletonText';
import { listUrl } from '@/features/lists/lib/list-links';
import type { ListSummary } from '@/features/lists/types';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';

// 卡片与骨架共用几何类，改动时两侧同步
export const LIST_GRID_CLASS =
  'grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-5 sm:gap-y-7 lg:grid-cols-3 2xl:grid-cols-4';
const LIST_COVER_CLASS = 'aspect-[16/9] rounded-xl';
const LIST_TITLE_CLASS = 'mt-3 text-[15px] leading-6';
const LIST_META_CLASS = 'mt-0.5 text-xs leading-5';

// 海报高度撑满封面区，宽为 2:3，四张恰好铺满 16:9 的宽度
const COVER_SLOTS = 4;
const POSTER_WIDTH_PERCENT = (9 * 2) / 3 / 16;
const POSTER_STEP_PERCENT = (1 - POSTER_WIDTH_PERCENT) / (COVER_SLOTS - 1);

export function ListCover({
  covers,
  title,
  className = LIST_COVER_CLASS,
}: {
  covers: string[];
  title: string;
  className?: string;
}) {
  const shown = covers.slice(0, COVER_SLOTS);
  return (
    <div
      className={`relative overflow-hidden bg-gray-200/70 dark:bg-white/[0.05] ${className}`}
    >
      {shown.length === 0 ? (
        <div className='absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-600'>
          <Clapperboard aria-hidden='true' className='h-8 w-8' />
        </div>
      ) : (
        shown.map((cover, index) => (
          <div
            key={`${index}:${cover}`}
            className='absolute inset-y-0 overflow-hidden bg-gray-300 shadow-[6px_0_14px_-4px_rgba(0,0,0,0.45)] dark:bg-gray-800'
            style={{
              left: `${index * POSTER_STEP_PERCENT * 100}%`,
              width: `${POSTER_WIDTH_PERCENT * 100}%`,
              zIndex: COVER_SLOTS - index,
            }}
          >
            <CoverImage
              src={cover}
              alt={index === 0 ? title : ''}
              sizes='120px'
              fallbackLabel=''
            />
          </div>
        ))
      )}
    </div>
  );
}

function ListMeta({
  list,
  showPrivacy,
}: {
  list: ListSummary;
  showPrivacy: boolean;
}) {
  return (
    <p
      className={`${LIST_META_CLASS} flex items-center gap-1.5 text-gray-500 dark:text-gray-400`}
    >
      <span className='tabular-nums'>{list.itemCount} 部</span>
      {showPrivacy && !list.isPublic && (
        <>
          <span aria-hidden='true'>·</span>
          <Lock aria-hidden='true' className='h-3 w-3' />
          <span>私密</span>
        </>
      )}
    </p>
  );
}

export function ListCard({
  list,
  showPrivacy = false,
}: {
  list: ListSummary;
  showPrivacy?: boolean;
}) {
  return (
    <Link href={listUrl(list.id)} className='group block'>
      <div className='transition duration-300 group-hover:-translate-y-0.5'>
        <ListCover covers={list.covers} title={list.name} />
      </div>
      <h3
        className={`${LIST_TITLE_CLASS} truncate font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
      >
        {list.name}
      </h3>
      <ListMeta list={list} showPrivacy={showPrivacy} />
    </Link>
  );
}

export function ListGrid({
  lists,
  showPrivacy = false,
}: {
  lists: ListSummary[];
  showPrivacy?: boolean;
}) {
  const containerRef = useListLayoutMotion<HTMLDivElement>(
    lists.map((list) => list.id),
  );
  return (
    <div ref={containerRef} className={`relative ${LIST_GRID_CLASS}`}>
      {lists.map((list) => (
        <div key={list.id} data-list-motion-key={list.id}>
          <ListCard list={list} showPrivacy={showPrivacy} />
        </div>
      ))}
    </div>
  );
}

export function ListGridSkeleton({ count }: { count: number }) {
  return (
    <div className={LIST_GRID_CLASS} role='status' aria-label='加载中'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className={`skeleton ${LIST_COVER_CLASS}`} />
          <SkeletonText
            className={LIST_TITLE_CLASS}
            barClassName='h-4 w-2/3 rounded'
          />
          <SkeletonText
            className={LIST_META_CLASS}
            barClassName='h-3 w-12 rounded'
          />
        </div>
      ))}
    </div>
  );
}
