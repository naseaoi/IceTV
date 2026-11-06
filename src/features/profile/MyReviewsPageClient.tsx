'use client';

import { MessageSquareText, PencilLine, SearchX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import CoverImage from '@/components/CoverImage';
import ExpandableText from '@/components/ExpandableText';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptySkeleton,
  LibraryEmptyState,
  LibraryPageFrame,
  LibrarySubtitleSkeleton,
} from '@/components/LibraryPage';
import { LibraryToolbar } from '@/components/LibraryToolbar';
import ConfirmModal from '@/components/modals/ConfirmModal';
import RatingBadge from '@/components/RatingBadge';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import { ReviewEditor } from '@/features/reviews/components/ReviewEditor';
import {
  type VideoReviewDraft,
  useVideoReviews,
} from '@/features/reviews/hooks/useVideoReviews';
import { formatRelativeTime } from '@/lib/relative-time';
import type { VideoReview } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';
import {
  MY_REVIEWS_PAGE_SIZE,
  VIDEO_REVIEWS_UPDATED_EVENT,
} from '@/lib/video-reviews';
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

const SKELETON_COUNT = MY_REVIEWS_PAGE_SIZE;
const reviewCounts = new Map<string, number>();
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
function useReviewSkeletonCount() {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  const [count, setCount] = useState(SKELETON_COUNT);
  useIsomorphicLayoutEffect(() => {
    setCount(
      profileId
        ? Math.min(
            reviewCounts.get(profileId) ?? SKELETON_COUNT,
            MY_REVIEWS_PAGE_SIZE,
          )
        : SKELETON_COUNT,
    );
  }, [profileId]);
  return { count, profileId, setCount };
}
const CARD_CLASS =
  'flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200 dark:bg-white/[0.03] dark:ring-white/10';

function reviewPlayUrl(review: VideoReview) {
  const target = parseStorageKey(review.source_key);
  return `/play?${new URLSearchParams({ title: review.title, year: review.year, ...(target ? { source: target.source, id: target.id } : {}) })}`;
}

function buildFilterOptions(counts: Record<ReviewFilter, number> | null) {
  return FILTERS.map((option) => ({
    ...option,
    count: counts?.[option.value] ?? 0,
  }));
}

function noop() {}

function ReviewListSkeleton({ count = SKELETON_COUNT }: { count?: number }) {
  if (count === 0) return <LibraryEmptySkeleton />;
  return (
    <ul
      aria-hidden='true'
      className='grid grid-cols-1 items-start gap-3 xl:grid-cols-2'
    >
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={CARD_CLASS}>
          <div className='skeleton aspect-[2/3] w-16 shrink-0 self-start rounded-lg sm:w-20' />
          <div className='min-w-0 flex-1'>
            <div className='flex h-6 items-center'>
              <div className='skeleton h-4 w-2/5 rounded' />
            </div>
            <div className='mt-1.5 flex h-5 items-center'>
              <div className='skeleton h-3 w-1/4 rounded' />
            </div>
            <div className='mt-2'>
              <div className='flex h-6 items-center'>
                <div className='skeleton h-3 w-full rounded' />
              </div>
              <div className='flex h-6 items-center'>
                <div className='skeleton h-3 w-3/4 rounded' />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MyReviewsPageSkeleton() {
  const { count } = useReviewSkeletonCount();
  return (
    <LibraryPageFrame
      title='我的评价'
      subtitle={<LibrarySubtitleSkeleton />}
      toolbar={
        count > 0 && (
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
        )
      }
    >
      <ReviewListSkeleton count={count} />
    </LibraryPageFrame>
  );
}

function ReviewEditDialog({
  review,
  onClose,
  onSaved,
  onSavingChange,
}: {
  review: VideoReview;
  onClose: () => void;
  onSaved: (review: VideoReview) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const { save } = useVideoReviews({
    title: review.title,
    year: review.year,
    cover: review.cover,
    doubanId: review.douban_id,
    sourceKey: review.source_key,
    summaryEnabled: false,
    initialReview: review,
  });
  const submit = async (draft: VideoReviewDraft) => {
    onSavingChange(true);
    try {
      onSaved(await save(draft));
    } finally {
      onSavingChange(false);
    }
  };
  return (
    <ReviewEditor
      variant='modal'
      initial={review}
      workTitle={review.title}
      onCancel={onClose}
      onSubmit={submit}
    />
  );
}

function ReviewCard({
  review,
  deleting,
  onDelete,
  onEdit,
}: {
  review: VideoReview;
  deleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
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
            className='min-w-0 flex-1 truncate font-semibold text-gray-900 transition hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400'
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
            aria-label={`编辑对${review.title}的评价`}
            disabled={deleting}
            onClick={onEdit}
            className='-mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-100'
          >
            <PencilLine className='h-4 w-4' />
          </button>
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
                ? 'bg-brand-500/10 text-brand-700 dark:text-brand-400'
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
  const {
    count: skeletonCount,
    profileId,
    setCount,
  } = useReviewSkeletonCount();
  const [reviews, setReviews] = useState<VideoReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [sort, setSort] = useState<ReviewSort>('updated');
  const [pending, setPending] = useState<VideoReview | null>(null);
  const [editing, setEditing] = useState<VideoReview | null>(null);
  const savingReview = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);
  const deferredQuery = useDeferredValue(query);

  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<ReviewFilter, number> | null>(
    null,
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const pageInFlight = useRef(false);
  const requestPage = useCallback(
    async (next?: string) => {
      if (next && pageInFlight.current) return;
      const current = next ? generation.current : ++generation.current;
      pageInFlight.current = true;
      if (next) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadingMore(false);
        setCursor(null);
      }
      setError('');
      try {
        const page = await fetchMyVideoReviews({
          cursor: next,
          q: deferredQuery.trim(),
          filter,
          sort,
        });
        if (current !== generation.current) return;
        setReviews((previous) =>
          next
            ? [
                ...previous,
                ...page.items.filter(
                  (item) =>
                    !previous.some(
                      (existing) =>
                        existing.title_norm === item.title_norm &&
                        existing.year === item.year,
                    ),
                ),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
        setTotal(page.total);
        setCounts(page.counts);
        setCount(Math.min(page.total, MY_REVIEWS_PAGE_SIZE));
        if (profileId) reviewCounts.set(profileId, page.total);
      } catch {
        if (current === generation.current) setError('评价加载失败，请重试');
      } finally {
        if (current === generation.current) {
          pageInFlight.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [deferredQuery, filter, sort, profileId, setCount],
  );

  useEffect(() => {
    void requestPage();
    return () => {
      generation.current += 1;
    };
  }, [version, requestPage]);
  useEffect(() => {
    const update = () => {
      // 本页保存由返回值就地更新，事件仍交给其他页面同步。
      if (!savingReview.current) setVersion((value) => value + 1);
    };
    window.addEventListener(VIDEO_REVIEWS_UPDATED_EVENT, update);
    return () =>
      window.removeEventListener(VIDEO_REVIEWS_UPDATED_EVENT, update);
  }, []);
  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    enabled: !!cursor && !loading && !loadingMore && !error,
    onLoadMore: () => {
      if (cursor) void requestPage(cursor);
    },
  });
  const filterOptions = useMemo(() => buildFilterOptions(counts), [counts]);
  const selected = reviews;
  const narrowed = deferredQuery.trim() !== '' || filter !== 'all';

  function applySavedReview(updated: VideoReview) {
    if (!editing) return;
    const previous = editing;
    const matchesQuery = (review: VideoReview) =>
      `${review.title} ${review.content}`
        .toLowerCase()
        .includes(deferredQuery.trim().toLowerCase());
    const matchesFilter = (review: VideoReview, value: ReviewFilter) =>
      value === 'all' ||
      (value === 'public' && review.is_public) ||
      (value === 'private' && !review.is_public) ||
      (value === 'text' && review.rating === null);
    setCounts(
      (current) =>
        current &&
        (Object.fromEntries(
          FILTERS.map(({ value }) => [
            value,
            current[value] +
              Number(matchesQuery(updated) && matchesFilter(updated, value)) -
              Number(matchesQuery(previous) && matchesFilter(previous, value)),
          ]),
        ) as Record<ReviewFilter, number> | null),
    );
    setReviews((current) =>
      current.flatMap((review) => {
        if (
          review.title_norm !== previous.title_norm ||
          review.year !== previous.year
        )
          return [review];
        return matchesQuery(updated) && matchesFilter(updated, filter)
          ? [updated]
          : [];
      }),
    );
    setEditing(null);
  }

  async function remove() {
    if (!pending || inFlight.current) return;
    const target = pending;
    inFlight.current = true;
    setDeleting(true);
    setError('');
    try {
      await deleteVideoReview(target.title, target.year, target.title_norm);
      setVersion((value) => value + 1);
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
    content = <ReviewListSkeleton count={skeletonCount} />;
  } else if (total === 0 && !narrowed) {
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
      <ul className='grid grid-cols-1 items-start gap-3 xl:grid-cols-2'>
        {selected.map((review) => (
          <ReviewCard
            key={`${review.title_norm}:${review.year}`}
            review={review}
            deleting={deleting}
            onDelete={() => setPending(review)}
            onEdit={() => setEditing(review)}
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
              {total}
            </span>{' '}
            条评价
            {narrowed && (
              <span aria-live='polite'>
                <span className='mx-1.5 text-gray-300 dark:text-gray-600'>
                  /
                </span>
                当前匹配{' '}
                <span className='tabular-nums'>{counts?.[filter] ?? 0}</span> 条
              </span>
            )}
          </>
        )
      }
      toolbar={
        ((loading && skeletonCount > 0) || total > 0 || narrowed) && (
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
      {!loading && cursor && (
        <div ref={sentinelRef} className='mt-3'>
          {loadingMore ? (
            <ReviewListSkeleton />
          ) : (
            <button
              type='button'
              className={LIBRARY_PILL_BUTTON_CLASS}
              onClick={() => void requestPage(cursor)}
            >
              加载更多
            </button>
          )}
        </div>
      )}
      {editing && (
        <ReviewEditDialog
          key={`${editing.title_norm}:${editing.year}`}
          review={editing}
          onClose={() => setEditing(null)}
          onSaved={applySavedReview}
          onSavingChange={(saving) => {
            savingReview.current = saving;
          }}
        />
      )}
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
