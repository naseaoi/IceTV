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
} from '@/components/LibraryPage';
import { LibraryToolbar } from '@/components/LibraryToolbar';
import ConfirmModal from '@/components/modals/ConfirmModal';
import RatingBadge from '@/components/RatingBadge';
import SkeletonText from '@/components/SkeletonText';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import { ReviewEditor } from '@/features/reviews/components/ReviewEditor';
import {
  type VideoReviewDraft,
  useVideoReviews,
} from '@/features/reviews/hooks/useVideoReviews';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import {
  getKnownMyReviewCount,
  rememberMyReviewCount,
} from '@/lib/my-review-count';
import { formatRelativeTime } from '@/lib/relative-time';
import type { MyVideoReviewPage, VideoReview } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
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

function matchesReviewFilter(review: VideoReview, filter: ReviewFilter) {
  return (
    filter === 'all' ||
    (filter === 'public' && review.is_public) ||
    (filter === 'private' && !review.is_public) ||
    (filter === 'text' && review.rating === null)
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
// initialCount 是服务端读到的计数快照，供首屏 HTML 使用；挂载后改用本标签页内更新的已知值
function useReviewSkeletonCount(initialCount: number) {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  const [count, setCount] = useState(() =>
    Math.min(initialCount, MY_REVIEWS_PAGE_SIZE),
  );
  useIsomorphicLayoutEffect(() => {
    const known = profileId ? getKnownMyReviewCount(profileId) : null;
    setCount(Math.min(known ?? initialCount, MY_REVIEWS_PAGE_SIZE));
  }, [initialCount, profileId]);
  return { count, profileId, setCount };
}
const CARD_CLASS =
  'flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200 dark:bg-white/[0.03] dark:ring-white/10';

const REVIEW_TITLE_TEXT_CLASS = 'font-semibold';
const REVIEW_META_CLASS =
  'mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs';
const REVIEW_VISIBILITY_CLASS = 'rounded px-1.5 py-0.5';
const REVIEW_BODY_SPACING_CLASS = 'mt-2';
const REVIEW_BODY_TEXT_CLASS = 'text-sm leading-6';

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

function ReviewListSkeleton({ count }: { count: number }) {
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
            <SkeletonText
              className={REVIEW_TITLE_TEXT_CLASS}
              barClassName='h-4 w-2/5 rounded'
            />
            <div className={REVIEW_META_CLASS}>
              <SkeletonText
                className={`${REVIEW_VISIBILITY_CLASS} w-full`}
                barClassName='h-3 w-1/4 rounded'
              />
            </div>
            <div className={REVIEW_BODY_SPACING_CLASS}>
              <SkeletonText
                className={REVIEW_BODY_TEXT_CLASS}
                barClassName='h-3 w-full rounded'
              />
              <SkeletonText
                className={REVIEW_BODY_TEXT_CLASS}
                barClassName='h-3 w-3/4 rounded'
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MyReviewsPageSkeleton({
  initialCount = 0,
}: {
  initialCount?: number;
}) {
  const { count } = useReviewSkeletonCount(initialCount);
  return (
    <LibraryPageFrame
      title='我的评价'
      toolbar={
        count > 0 && (
          <LibraryToolbar
            searchLabel='搜索我的评价'
            countsKey='reviews'
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
  review: target,
  onClose,
  onSaved,
  onSavingChange,
}: {
  review: VideoReview | null;
  onClose: () => void;
  onSaved: (review: VideoReview) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const review = useRetainedValue(target);
  const { save } = useVideoReviews({
    title: review?.title ?? '',
    year: review?.year ?? '',
    cover: review?.cover ?? '',
    doubanId: review?.douban_id ?? 0,
    sourceKey: review?.source_key ?? '',
    summaryEnabled: false,
    initialReview: review ?? undefined,
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
      isOpen={Boolean(target)}
      initial={review ?? null}
      workTitle={review?.title ?? ''}
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
    <li
      data-list-motion-key={`${review.title_norm}:${review.year}`}
      className={CARD_CLASS}
    >
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
            className={`min-w-0 flex-1 truncate ${REVIEW_TITLE_TEXT_CLASS} text-gray-900 transition hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400`}
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
        <div
          className={`${REVIEW_META_CLASS} text-gray-500 dark:text-gray-400`}
        >
          {review.rating !== null && <RatingBadge value={review.rating} />}
          <span
            className={`${REVIEW_VISIBILITY_CLASS} ${
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
            className={`${REVIEW_BODY_SPACING_CLASS} ${REVIEW_BODY_TEXT_CLASS} text-gray-700 dark:text-gray-300`}
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

export default function MyReviewsPageClient({
  initialSkeletonCount = 0,
}: {
  initialSkeletonCount?: number;
}) {
  const {
    count: skeletonCount,
    profileId,
    setCount,
  } = useReviewSkeletonCount(initialSkeletonCount);
  const [mutationError, setMutationError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [sort, setSort] = useState<ReviewSort>('updated');
  const [pending, setPending] = useState<VideoReview | null>(null);
  const [editing, setEditing] = useState<VideoReview | null>(null);
  const savingReview = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);
  const deferredQuery = useDeferredValue(query);

  const q = deferredQuery.trim();
  const fetchPage = useCallback(
    async (
      cursor: string | undefined,
      signal: AbortSignal,
    ): Promise<MyVideoReviewPage & { countsQuery: string }> => ({
      ...(await fetchMyVideoReviews({ cursor, q, filter, sort }, signal)),
      countsQuery: q,
    }),
    [q, filter, sort],
  );
  const {
    data,
    initialLoading,
    refreshing,
    loadingMore,
    error: queryError,
    loadMore,
    refresh: refreshPage,
    retry: retryPage,
    updateData,
  } = usePagedQuery({
    scopeKey: profileId,
    queryKey: JSON.stringify([q, filter, sort]),
    fetchPage,
    getItemKey: (review) => JSON.stringify([review.title_norm, review.year]),
  });
  const reviews = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? null;
  const countsQuery = data?.countsQuery;
  const cursor = data?.nextCursor;
  const loading = initialLoading || refreshing;
  const error = mutationError || (queryError ? '评价加载失败，请重试' : '');
  const refresh = useCallback(() => {
    setMutationError('');
    refreshPage();
  }, [refreshPage]);

  useEffect(() => {
    // 只有未搜索时的「全部」计数才是本人评价总数
    if (!data || data.countsQuery !== '') return;
    setCount(Math.min(data.counts.all, MY_REVIEWS_PAGE_SIZE));
    if (profileId) rememberMyReviewCount(profileId, data.counts.all);
  }, [data, profileId, setCount]);

  useEffect(() => {
    const update = () => {
      // 本页保存由返回值就地更新，事件仍交给其他页面同步。
      if (!savingReview.current) refresh();
    };
    window.addEventListener(VIDEO_REVIEWS_UPDATED_EVENT, update);
    return () =>
      window.removeEventListener(VIDEO_REVIEWS_UPDATED_EVENT, update);
  }, [refresh]);
  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    enabled:
      !!cursor && !initialLoading && !refreshing && !loadingMore && !error,
    onLoadMore: loadMore,
  });
  const filterOptions = useMemo(() => buildFilterOptions(counts), [counts]);
  // 计数与当前筛选无关，重新查询时沿用旧值，避免占位块让胶囊宽度来回跳
  const countsLoading = loading && counts === null;
  const selected = reviews;
  const containerRef = useListLayoutMotion<HTMLUListElement>(
    selected.map((review) => `${review.title_norm}:${review.year}`),
  );
  const narrowed = deferredQuery.trim() !== '' || filter !== 'all';
  const knownCount =
    counts && countsQuery === deferredQuery.trim() ? counts[filter] : null;
  const listSkeletonCount =
    knownCount === null
      ? skeletonCount
      : Math.min(knownCount, MY_REVIEWS_PAGE_SIZE);
  const moreSkeletonCount =
    knownCount === null
      ? MY_REVIEWS_PAGE_SIZE
      : Math.min(
          Math.max(knownCount - reviews.length, 1),
          MY_REVIEWS_PAGE_SIZE,
        );
  // 新条件已知为空时直接给空状态；否则重新查询期间沿用屏幕上的旧结果（列表或空状态）并变暗
  const listEmpty = loading
    ? knownCount === 0 || (data !== null && selected.length === 0)
    : selected.length === 0;
  const dimmed = refreshing && knownCount !== 0;

  function applySavedReview(updated: VideoReview) {
    if (!editing) return;
    const previous = editing;
    const matchesQuery = (review: VideoReview) =>
      `${review.title} ${review.content}`
        .toLowerCase()
        .includes(deferredQuery.trim().toLowerCase());
    updateData((current) => {
      if (!current) return current;
      const items = current.items.flatMap((review) => {
        if (
          review.title_norm !== previous.title_norm ||
          review.year !== previous.year
        )
          return [review];
        return matchesQuery(updated) && matchesReviewFilter(updated, filter)
          ? [updated]
          : [];
      });
      return {
        ...current,
        items,
        counts: Object.fromEntries(
          FILTERS.map(({ value }) => [
            value,
            current.counts[value] +
              Number(
                matchesQuery(updated) && matchesReviewFilter(updated, value),
              ) -
              Number(
                matchesQuery(previous) && matchesReviewFilter(previous, value),
              ),
          ]),
        ) as Record<ReviewFilter, number>,
      };
    });
    setEditing(null);
  }

  async function remove() {
    if (!pending || inFlight.current) return;
    const target = pending;
    inFlight.current = true;
    setDeleting(true);
    setMutationError('');
    try {
      await deleteVideoReview(target.title, target.year, target.title_norm);
      updateData(
        (current) =>
          current && {
            ...current,
            items: current.items.filter(
              (review) =>
                review.title_norm !== target.title_norm ||
                review.year !== target.year,
            ),
          },
      );
      refresh();
      setPending(null);
    } catch (error) {
      if (!isAbortError(error))
        setMutationError(getErrorMessage(error, '删除失败，请重试'));
      throw error;
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  let content: React.ReactNode;
  if (initialLoading && !listEmpty) {
    content = <ReviewListSkeleton count={listSkeletonCount} />;
  } else if (listEmpty && !narrowed) {
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
  } else if (listEmpty) {
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
      <ul
        ref={containerRef}
        className='relative grid grid-cols-1 items-start gap-3 xl:grid-cols-2'
      >
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
      toolbar={
        ((loading && skeletonCount > 0) || total > 0 || narrowed) && (
          <LibraryToolbar
            searchLabel='搜索我的评价'
            countsKey='reviews'
            query={query}
            onQueryChange={setQuery}
            filterOptions={filterOptions}
            filter={filter}
            onFilterChange={setFilter}
            sortOptions={SORT_OPTIONS}
            sort={sort}
            onSortChange={setSort}
            loading={countsLoading}
          />
        )
      }
    >
      {error && (
        <p role='alert' className='mb-4 text-sm text-red-500'>
          {error}
          <button
            type='button'
            onClick={queryError ? retryPage : refresh}
            className='ml-3 underline'
          >
            重新加载
          </button>
        </p>
      )}
      <div
        aria-busy={dimmed}
        inert={dimmed}
        className={`transition-opacity duration-200 ${dimmed ? 'opacity-60' : ''}`}
      >
        {content}
      </div>
      {!loading && cursor && (
        <div ref={sentinelRef} className='mt-3'>
          {loadingMore ? (
            <ReviewListSkeleton count={moreSkeletonCount} />
          ) : (
            <button
              type='button'
              className={LIBRARY_PILL_BUTTON_CLASS}
              onClick={loadMore}
            >
              加载更多
            </button>
          )}
        </div>
      )}
      <ReviewEditDialog
        review={editing}
        onClose={() => setEditing(null)}
        onSaved={applySavedReview}
        onSavingChange={(saving) => {
          savingReview.current = saving;
        }}
      />
      <ConfirmModal
        isOpen={pending !== null}
        title='删除评价'
        message={`确认删除对《${pending?.title ?? ''}》的评价？删除后无法恢复。`}
        danger
        confirmText='确认删除'
        confirmDisabled={deleting}
        onConfirm={remove}
        onClose={() => {
          if (!deleting) setPending(null);
        }}
      />
    </LibraryPageFrame>
  );
}
