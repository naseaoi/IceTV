'use client';

import {
  Clapperboard,
  Eye,
  Heart,
  HeartOff,
  ListVideo,
  Lock,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import AnimatedCount from '@/components/AnimatedCount';
import CoverImage from '@/components/CoverImage';
import { POSTER_BADGE_NEUTRAL_CLASS } from '@/components/poster-card-layout';
import ProfileAvatar from '@/components/ProfileAvatar';
import SkeletonText from '@/components/SkeletonText';
import { formatCompactCount } from '@/features/lists/lib/compact-count';
import { listUrl } from '@/features/lists/lib/list-links';
import type { ListSummary, SavedListSummary } from '@/features/lists/types';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import type { PublicUserRef } from '@/lib/types';

import { ListVisibilityBadge } from './ListVisibilityBadge';

// 卡片与骨架共用几何类，改动时两侧同步
const LIST_GRID_BASE_CLASS =
  'grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-5 sm:gap-y-8';
const LIST_GRID_CLASS = `${LIST_GRID_BASE_CLASS} lg:grid-cols-3 2xl:grid-cols-4`;
// 桌面端左右分栏时按内容区宽度排列，不跟视口断点
export const SIDEBAR_LIST_GRID_CLASS = `${LIST_GRID_BASE_CLASS} lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`;
const LIST_COVER_CLASS = 'aspect-[16/9] rounded-xl';
const LIST_TITLE_CLASS = 'mt-3 text-[15px] leading-6';
const LIST_DESCRIPTION_CLASS = 'mt-0.5 text-[13px] leading-5';
const LIST_META_CLASS = 'mt-1.5 text-xs leading-5';

// 海报高度撑满封面区，宽为 2:3，四张恰好铺满 16:9 的宽度
const COVER_SLOTS = 4;
const POSTER_WIDTH_PERCENT = (9 * 2) / 3 / 16;
const POSTER_STEP_PERCENT = (1 - POSTER_WIDTH_PERCENT) / (COVER_SLOTS - 1);
// 悬停时后面的海报依次右移，像翻开一叠海报；位移按单张海报宽度计
const FAN_SHIFT_PERCENT = 14;

export function ListCover({
  covers,
  title,
  className = LIST_COVER_CLASS,
  fan = false,
  children,
}: {
  covers: string[];
  title: string;
  className?: string;
  // 需外层带 group 类
  fan?: boolean;
  children?: ReactNode;
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
        <>
          {shown.length < COVER_SLOTS && (
            // 不足四张时用首张海报的模糊色铺满留白
            <div
              aria-hidden='true'
              className='absolute inset-0 scale-110 opacity-70 blur-2xl dark:opacity-50'
            >
              <CoverImage src={shown[0]} alt='' sizes='96px' fallbackLabel='' />
            </div>
          )}
          {shown.map((cover, index) => (
            <div
              key={`${index}:${cover}`}
              className={`absolute inset-y-0 overflow-hidden bg-gray-300 shadow-[6px_0_14px_-4px_rgba(0,0,0,0.45)] dark:bg-gray-800 ${
                fan
                  ? 'transition-transform duration-500 ease-[var(--motion-spring-soft)] motion-safe:sm:group-hover:translate-x-[var(--fan-shift)]'
                  : ''
              }`}
              style={
                {
                  left: `${index * POSTER_STEP_PERCENT * 100}%`,
                  width: `${POSTER_WIDTH_PERCENT * 100}%`,
                  zIndex: COVER_SLOTS - index,
                  '--fan-shift': `${index * FAN_SHIFT_PERCENT}%`,
                } as CSSProperties
              }
            >
              <CoverImage
                src={cover}
                alt={index === 0 ? title : ''}
                sizes='120px'
                fallbackLabel=''
              />
            </div>
          ))}
        </>
      )}
      {children}
    </div>
  );
}

// 私密片单保留历史收藏数，没有收藏时隐藏统计
export function ListStats({
  list,
  iconClassName,
}: {
  list: Pick<ListSummary, 'viewCount' | 'likeCount' | 'visibility'>;
  iconClassName: string;
}) {
  const showLikes = list.visibility !== 'private' || list.likeCount > 0;
  return (
    <span className='inline-flex shrink-0 items-center gap-3 tabular-nums'>
      <span
        className='inline-flex items-center gap-1'
        aria-label={`${list.viewCount} 次浏览`}
      >
        <Eye aria-hidden='true' className={iconClassName} />
        {formatCompactCount(list.viewCount)}
      </span>
      {showLikes && (
        <span
          className='inline-flex items-center gap-1'
          aria-label={`${list.likeCount} 人收藏`}
          title='收藏'
        >
          <Heart aria-hidden='true' className={iconClassName} />
          <AnimatedCount value={list.likeCount} format={formatCompactCount} />
        </span>
      )}
    </span>
  );
}

export function ListCard({
  list,
  owner,
  showPrivacy = false,
}: {
  list: ListSummary;
  owner?: PublicUserRef;
  showPrivacy?: boolean;
}) {
  const description = list.description.trim();
  return (
    <Link href={listUrl(list.id)} className='group block'>
      <ListCover covers={list.covers} title={list.name} fan>
        {showPrivacy && list.visibility !== 'members' && (
          <span className='absolute left-2 top-2 z-10'>
            <ListVisibilityBadge visibility={list.visibility} variant='cover' />
          </span>
        )}
        <span
          className={`${POSTER_BADGE_NEUTRAL_CLASS} absolute bottom-2 right-2 z-10 gap-1`}
        >
          <ListVideo aria-hidden='true' className='h-3 w-3' />
          {list.itemCount} 部
        </span>
      </ListCover>
      <h3
        className={`${LIST_TITLE_CLASS} truncate font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
      >
        {list.name}
      </h3>
      <p
        className={`${LIST_DESCRIPTION_CLASS} truncate ${
          description
            ? 'text-gray-500 dark:text-gray-400'
            : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        {description || '暂无介绍'}
      </p>
      <div
        className={`${LIST_META_CLASS} flex items-center gap-3 whitespace-nowrap text-gray-500 dark:text-gray-400`}
      >
        {owner && (
          <span className='inline-flex min-w-0 flex-1 items-center gap-1.5 text-gray-700 dark:text-gray-300'>
            <ProfileAvatar user={owner} className='h-4 w-4 shrink-0' />
            <span className='truncate'>{owner.nickname ?? '未设置昵称'}</span>
          </span>
        )}
        <ListStats list={list} iconClassName='h-3 w-3' />
      </div>
    </Link>
  );
}

export function ListGrid({
  lists,
  showPrivacy = false,
  gridClassName = LIST_GRID_CLASS,
}: {
  lists: (ListSummary & { owner?: PublicUserRef })[];
  showPrivacy?: boolean;
  gridClassName?: string;
}) {
  const containerRef = useListLayoutMotion<HTMLDivElement>(
    lists.map((list) => list.id),
  );
  return (
    <div ref={containerRef} className={`relative ${gridClassName}`}>
      {lists.map((list) => (
        <div key={list.id} data-list-motion-key={list.id}>
          <ListCard list={list} owner={list.owner} showPrivacy={showPrivacy} />
        </div>
      ))}
    </div>
  );
}

export function SavedListGrid({
  lists,
  onUnsave,
}: {
  lists: SavedListSummary[];
  onUnsave: (list: SavedListSummary) => void;
}) {
  const containerRef = useListLayoutMotion<HTMLDivElement>(
    lists.map((list) => list.id),
  );
  return (
    <div ref={containerRef} className={`relative ${LIST_GRID_CLASS}`}>
      {lists.map((list) => {
        const Icon = list.status === 'deleted' ? Trash2 : Lock;
        return (
          <div key={list.id} data-list-motion-key={list.id}>
            {list.status === 'available' ? (
              <ListCard list={list} owner={list.owner} />
            ) : (
              <article aria-label={list.name}>
                <div
                  className={`${LIST_COVER_CLASS} flex flex-col items-center justify-center gap-2 bg-gray-200/70 text-gray-500 dark:bg-white/[0.05] dark:text-gray-400`}
                >
                  <Icon aria-hidden='true' className='h-6 w-6 stroke-[1.5]' />
                  <span className='text-xs'>
                    {list.status === 'deleted' ? '作者已删除' : '作者暂不公开'}
                  </span>
                </div>
                <h3
                  title={list.name}
                  className={`${LIST_TITLE_CLASS} truncate font-medium text-gray-500 dark:text-gray-400`}
                >
                  {list.name}
                </h3>
                {/* 保留简介行，取消收藏与可读卡片的统计行对齐。 */}
                <div aria-hidden='true' className={LIST_DESCRIPTION_CLASS}>
                  &nbsp;
                </div>
                <div className={`${LIST_META_CLASS} flex items-center`}>
                  <button
                    type='button'
                    aria-label={`取消收藏「${list.name}」`}
                    onClick={() => onUnsave(list)}
                    className='inline-flex items-center gap-1 text-gray-500 transition-colors hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400'
                  >
                    <HeartOff aria-hidden='true' className='h-3.5 w-3.5' />
                    取消收藏
                  </button>
                </div>
              </article>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ListGridSkeleton({
  count,
  gridClassName = LIST_GRID_CLASS,
}: {
  count: number;
  gridClassName?: string;
}) {
  return (
    <div className={gridClassName} role='status' aria-label='加载中'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className={`skeleton ${LIST_COVER_CLASS}`} />
          <SkeletonText
            className={LIST_TITLE_CLASS}
            barClassName='h-4 w-2/3 rounded'
          />
          <SkeletonText
            className={LIST_DESCRIPTION_CLASS}
            barClassName='h-3 w-1/2 rounded'
          />
          <SkeletonText
            className={LIST_META_CLASS}
            barClassName='h-3 w-24 rounded'
          />
        </div>
      ))}
    </div>
  );
}
