'use client';

import { MessageSquareText, SearchX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import ExpandableText from '@/components/ExpandableText';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptyState,
  LibraryPageFrame,
  LibrarySubtitleSkeleton,
} from '@/components/LibraryPage';
import { LibraryToolbar } from '@/components/LibraryToolbar';
import ConfirmModal from '@/components/modals/ConfirmModal';
import RatingBadge from '@/components/RatingBadge';
import { formatRelativeTime } from '@/lib/relative-time';
import type { VideoReview } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';
import {
  deleteVideoReview,
  fetchMyVideoReviews,
} from '@/lib/video-reviews.client';

type ReviewFilter = 'all' | 'public' | 'private' | 'text';
type ReviewSort = 'updated' | 'high' | 'low';

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'public', label: '公开' },
  { value: 'private', label: '私密' },
  { value: 'text', label: '仅文字' },
];

const SORT_OPTIONS: { value: ReviewSort; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'high', label: '评分从高到低' },
  { value: 'low', label: '评分从低到高' },
];

const SKELETON_COUNT = 4;
const CARD_CLASS =
  'flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200 dark:bg-white/[0.03] dark:ring-white/10';

function matchesFilter(review: VideoReview, filter: ReviewFilter) {
  if (filter === 'public') return review.is_public;
  if (filter === 'private') return !review.is_public;
  if (filter === 'text') return review.rating === null;
  return true;
}

// 无评分的排在评分排序末尾
function compareReviews(a: VideoReview, b: VideoReview, sort: ReviewSort) {
  if (sort === 'updated' || a.rating === b.rating) {
    return b.updated_at - a.updated_at;
  }
  if (a.rating === null) return 1;
  if (b.rating === null) return -1;
  return sort === 'high' ? b.rating - a.rating : a.rating - b.rating;
}

function reviewPlayUrl(review: VideoReview) {
  const target = parseStorageKey(review.source_key);
  return `/play?${new URLSearchParams({ title: review.title, year: review.year, ...(target ? { source: target.source, id: target.id } : {}) })}`;
}

function buildFilterOptions(reviews: VideoReview[] | null) {
  return FILTERS.map((option) => ({
    ...option,
    count: reviews
      ? reviews.filter((review) => matchesFilter(review, option.value)).length
      : 0,
  }));
}

function noop() {}

function ReviewListSkeleton() {
  return (
    <ul aria-hidden='true' className='grid items-start gap-3 xl:grid-cols-2'>
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index} className={CARD_CLASS}>
          <div className='aspect-[2/3] w-16 shrink-0 animate-pulse rounded-lg bg-gray-200 dark:bg-white/10 sm:w-20' />
          <div className='min-w-0 flex-1 space-y-3 py-1'>
            <div className='h-4 w-2/5 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
            <div className='h-3 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
            <div className='h-3 w-full animate-pulse rounded bg-gray-200 dark:bg-white/10' />
            <div className='h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MyReviewsPageSkeleton() {
  return (
    <LibraryPageFrame
      title='我的评价'
      subtitle={<LibrarySubtitleSkeleton />}
      toolbar={
        <LibraryToolbar
          searchLabel='搜索我的评价'
          query=''
          onQueryChange={noop}
          filterOptions={buildFilterOptions(null)}
          filter='all'
          onFilterChange={noop}
          sortOptions={SORT_OPTIONS}
          sort='updated'
          onSortChange={noop}
          loading
        />
      }
    >
      <ReviewListSkeleton />
    </LibraryPageFrame>
  );
}

function ReviewCard({
  review,
  deleting,
  onDelete,
}: {
  review: VideoReview;
  deleting: boolean;
  onDelete: () => void;
}) {
  const playUrl = reviewPlayUrl(review);
  return (
    <li className={CARD_CLASS}>
      <Link
        href={playUrl}
        aria-label={`播放${review.title}`}
        className='relative aspect-[2/3] w-16 shrink-0 self-start overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 sm:w-20'
      >
        <CoverImage src={review.cover} alt={review.title} sizes='80px' />
      </Link>
      <div className='min-w-0 flex-1'>
        <div className='flex items-start gap-2'>
          <Link
            href={playUrl}
            className='min-w-0 flex-1 truncate font-semibold text-gray-900 transition hover:text-green-600 dark:text-gray-100 dark:hover:text-green-400'
          >
            {review.title}
            {review.year && (
              <span className='ml-1.5 text-xs font-normal text-gray-500'>
                {review.year}
              </span>
            )}
          </Link>
          <button
            type='button'
            aria-label={`删除对${review.title}的评价`}
            disabled={deleting}
            onClick={onDelete}
            className='-mr-1.5 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10'
          >
            <Trash2 className='h-4 w-4' />
          </button>
        </div>
        <div className='mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
          {review.rating !== null && <RatingBadge value={review.rating} />}
          <span
            className={`rounded px-1.5 py-0.5 ${
              review.is_public
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : 'bg-gray-100 dark:bg-white/[0.06]'
            }`}
          >
            {review.is_public ? '公开' : '私密'}
          </span>
          {review.spoiler && (
            <span className='rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400'>
              包含剧透
            </span>
          )}
          <span>{formatRelativeTime(review.updated_at)}更新</span>
        </div>
        {review.content ? (
          <ExpandableText
            text={review.content}
            className='mt-2 text-sm leading-6 text-gray-700 dark:text-gray-300'
          />
        ) : (
          <p className='mt-2 text-sm text-gray-400 dark:text-gray-500'>
            仅评分，未填写评价
          </p>
        )}
      </div>
    </li>
  );
}

export default function MyReviewsPageClient() {
  const [reviews, setReviews] = useState<VideoReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [sort, setSort] = useState<ReviewSort>('updated');
  const [pending, setPending] = useState<VideoReview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchMyVideoReviews()
      .then((items) => {
        if (active) setReviews(items);
      })
      .catch(() => {
        if (active) setError('评价加载失败，请重试');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  const searched = useMemo(() => {
    const keyword = deferredQuery.trim().toLocaleLowerCase();
    if (!keyword) return reviews;
    return reviews.filter((review) =>
      `${review.title} ${review.content}`.toLocaleLowerCase().includes(keyword),
    );
  }, [reviews, deferredQuery]);
  const filterOptions = useMemo(() => buildFilterOptions(searched), [searched]);
  const selected = useMemo(
    () =>
      searched
        .filter((review) => matchesFilter(review, filter))
        .sort((a, b) => compareReviews(a, b, sort)),
    [searched, filter, sort],
  );
  const narrowed = deferredQuery.trim() !== '' || filter !== 'all';

  async function remove() {
    if (!pending || inFlight.current) return;
    const target = pending;
    inFlight.current = true;
    setDeleting(true);
    setError('');
    try {
      await deleteVideoReview(target.title, target.year, target.title_norm);
      setReviews((items) =>
        items.filter(
          (item) =>
            item.title_norm !== target.title_norm || item.year !== target.year,
        ),
      );
      setPending(null);
    } catch {
      setError('删除失败，请重试');
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  let content: React.ReactNode;
  if (loading) {
    content = <ReviewListSkeleton />;
  } else if (reviews.length === 0) {
    content = error ? null : (
      <LibraryEmptyState
        icon={MessageSquareText}
        title='还没有评价'
        description='在播放页的「评价」里打分或写下感受，就会出现在这里'
        action={
          <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
            去首页逛逛
          </Link>
        }
      />
    );
  } else if (selected.length === 0) {
    content = (
      <LibraryEmptyState
        icon={SearchX}
        title='暂无符合条件的评价'
        description={
          deferredQuery.trim()
            ? `找不到与「${deferredQuery.trim()}」相关的评价`
            : '当前筛选下没有评价'
        }
        action={
          <button
            type='button'
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
            className={LIBRARY_PILL_BUTTON_CLASS}
          >
            清除筛选
          </button>
        }
      />
    );
  } else {
    content = (
      <ul className='grid items-start gap-3 xl:grid-cols-2'>
        {selected.map((review) => (
          <ReviewCard
            key={`${review.title_norm}:${review.year}`}
            review={review}
            deleting={deleting}
            onDelete={() => setPending(review)}
          />
        ))}
      </ul>
    );
  }

  return (
    <LibraryPageFrame
      title='我的评价'
      subtitle={
        loading ? (
          <LibrarySubtitleSkeleton />
        ) : (
          <>
            <span className='font-medium tabular-nums text-gray-900 dark:text-gray-100'>
              {reviews.length}
            </span>{' '}
            条评价 · 私密评价仅自己可见
            {narrowed && (
              <span aria-live='polite'>
                <span className='mx-1.5 text-gray-300 dark:text-gray-600'>
                  /
                </span>
                当前显示 <span className='tabular-nums'>{selected.length}</span>{' '}
                条
              </span>
            )}
          </>
        )
      }
      toolbar={
        (loading || reviews.length > 0) && (
          <LibraryToolbar
            searchLabel='搜索我的评价'
            query={query}
            onQueryChange={setQuery}
            filterOptions={filterOptions}
            filter={filter}
            onFilterChange={setFilter}
            sortOptions={SORT_OPTIONS}
            sort={sort}
            onSortChange={setSort}
            loading={loading}
          />
        )
      }
    >
      {error && (
        <p role='alert' className='mb-4 text-sm text-red-500'>
          {error}
          <button
            type='button'
            onClick={() => setVersion((value) => value + 1)}
            className='ml-3 underline'
          >
            重新加载
          </button>
        </p>
      )}
      {content}
      <ConfirmModal
        isOpen={pending !== null}
        title='删除评价'
        message={`确认删除对《${pending?.title ?? ''}》的评价？删除后无法恢复。`}
        danger
        confirmText='确认删除'
        confirmDisabled={deleting}
        onConfirm={() => void remove()}
        onClose={() => {
          if (!deleting) setPending(null);
        }}
      />
    </LibraryPageFrame>
  );
}
