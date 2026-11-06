'use client';

import { Globe, Lock, PencilLine, RotateCw, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import ExpandableText from '@/components/ExpandableText';
import { PLAYER_PANEL_INSET_CLASS } from '@/components/PlayerPanelTabBar';
import PublicReviewContent from '@/components/PublicReviewContent';
import RatingStars from '@/components/RatingStars';
import Spinner from '@/components/Spinner';
import ReviewDistribution from '@/features/play/components/EpisodeSelector/ReviewDistribution';
import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { ReviewEditor } from '@/features/reviews/components/ReviewEditor';
import type {
  VideoReviewDraft,
  VideoReviewsState,
} from '@/features/reviews/hooks/useVideoReviews';
import { formatRating } from '@/lib/rating';
import { formatRelativeTime } from '@/lib/relative-time';
import type { VideoReview } from '@/lib/types';

interface ReviewsTabProps {
  workTitle: string;
  reviews: VideoReviewsState;
  favorited: boolean;
  onAddFavorite?: () => void;
  // 简介区评分入口跳转过来时为 true，处理后经回调复位
  editRequested: boolean;
  onEditRequestHandled: () => void;
}

const surfaceClass =
  'rounded-xl bg-white ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10';

const iconButtonClass =
  'inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100';

function MyReviewCard({
  review,
  onEdit,
  onDelete,
}: {
  review: VideoReview;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    setError('');
    try {
      await onDelete();
    } catch {
      setError('删除失败，请稍后重试');
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className={`${surfaceClass} px-4 py-3`}>
      <div className='flex items-center gap-2.5'>
        {review.rating !== null ? (
          <>
            <span className='text-2xl font-semibold tabular-nums leading-none text-amber-600 dark:text-amber-400'>
              {formatRating(review.rating)}
            </span>
            <RatingStars value={review.rating} size='sm' />
          </>
        ) : (
          <span className='text-sm text-gray-500 dark:text-gray-400'>
            未评分
          </span>
        )}
        <div className='-mr-2 ml-auto flex items-center'>
          <button
            type='button'
            className={iconButtonClass}
            disabled={deleting}
            onClick={onEdit}
          >
            <PencilLine className='h-3.5 w-3.5' />
            编辑
          </button>
          <button
            type='button'
            className={`${iconButtonClass} ${
              confirming
                ? 'bg-red-500/10 text-red-600 hover:bg-red-500/15 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400'
                : 'hover:text-red-600 dark:hover:text-red-400'
            }`}
            disabled={deleting}
            onClick={handleDelete}
            onBlur={() => setConfirming(false)}
          >
            {deleting ? (
              <Spinner className='h-3.5 w-3.5' />
            ) : (
              <Trash2 className='h-3.5 w-3.5' />
            )}
            {confirming ? '确认删除' : '删除'}
          </button>
        </div>
      </div>

      {review.content && (
        <div className='mt-2.5'>
          <ExpandableText
            text={review.content}
            lines={6}
            maxChars={240}
            className='text-[13px] leading-[1.75] text-gray-700 dark:text-gray-300'
          />
        </div>
      )}

      <p className='mt-2 flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500'>
        {review.is_public ? (
          <Globe aria-hidden='true' className='h-3 w-3' />
        ) : (
          <Lock aria-hidden='true' className='h-3 w-3' />
        )}
        {review.is_public ? '公开' : '仅自己可见'}
        <span aria-hidden='true'>·</span>
        {formatRelativeTime(review.updated_at)}更新
      </p>

      {error && (
        <p role='alert' className='mt-1 text-[11px] text-red-500'>
          {error}
        </p>
      )}
    </div>
  );
}

export const ReviewsTab: React.FC<ReviewsTabProps> = ({
  workTitle,
  reviews,
  favorited,
  onAddFavorite,
  editRequested,
  onEditRequestHandled,
}) => {
  const {
    myReview,
    myReviewLoading,
    summary,
    summaryLoading,
    summaryError,
    save,
    remove,
    reloadSummary,
    loadMoreReviews,
    reviewsLoadingMore,
  } = reviews;
  const [editing, setEditing] = useState(false);
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;

  useEffect(() => {
    if (!editRequested) return;
    setEditing(true);
    onEditRequestHandled();
  }, [editRequested, onEditRequestHandled]);

  const handleSubmit = async (draft: VideoReviewDraft) => {
    if (!favorited) onAddFavorite?.();
    await save(draft);
    setEditing(false);
  };

  const showEditor = editing || (!myReview && !myReviewLoading);
  const average = summary?.average ?? null;

  return (
    <div
      className={`min-w-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden pb-5 pt-4 ${PLAYER_PANEL_INSET_CLASS}`}
    >
      {summaryLoading && !summary ? (
        <div className='flex justify-center py-4'>
          <Spinner className='h-5 w-5 text-gray-400' />
        </div>
      ) : (
        summary &&
        average !== null && (
          <section aria-label='评分概览' className='flex items-end gap-5'>
            <div className='shrink-0 space-y-1.5'>
              <span className='block text-[2.25rem] font-semibold tabular-nums leading-none tracking-tight text-gray-900 dark:text-gray-50'>
                {formatRating(average)}
              </span>
              <RatingStars value={average} size='sm' decorative />
              <p className='text-[11px] text-gray-500 dark:text-gray-400'>
                {summary.count} 人公开评分
              </p>
            </div>
            <ReviewDistribution distribution={summary.distribution} />
          </section>
        )
      )}

      <section className='space-y-2'>
        <SectionTitle label='我的评价' />
        {myReviewLoading && !myReview ? (
          <div className='flex justify-center py-6'>
            <Spinner className='h-5 w-5 text-gray-400' />
          </div>
        ) : showEditor ? (
          <ReviewEditor
            key={myReview?.updated_at ?? 'new'}
            initial={myReview}
            workTitle={workTitle}
            onCancel={myReview ? () => setEditing(false) : undefined}
            onSubmit={handleSubmit}
          />
        ) : (
          myReview && (
            <MyReviewCard
              review={myReview}
              onEdit={() => setEditing(true)}
              onDelete={remove}
            />
          )
        )}
      </section>

      <section className='space-y-2'>
        <SectionTitle
          label='大家的评价'
          count={summary?.reviewCount ?? summary?.reviews.length}
        >
          {summaryError && (
            <button
              type='button'
              className={iconButtonClass}
              onClick={reloadSummary}
            >
              <RotateCw className='h-3.5 w-3.5' />
              重试
            </button>
          )}
        </SectionTitle>
        {summary && summary.reviews.length > 0 ? (
          <ul className='divide-y divide-gray-100 dark:divide-white/[0.06]'>
            {summary.reviews.map((review) => (
              <li
                key={`${review.author.profileId}:${review.year}`}
                className='py-3.5 first:pt-0 last:pb-0'
              >
                <PublicReviewContent
                  review={review}
                  isMine={review.author.profileId === profileId}
                />
              </li>
            ))}
          </ul>
        ) : (
          !summaryLoading &&
          !summaryError && (
            <p className='py-1 text-[13px] text-gray-500 dark:text-gray-400'>
              还没有公开评价，来写第一条吧
            </p>
          )
        )}
        {summary?.nextCursor && (
          <div className='flex justify-center py-3'>
            <button
              type='button'
              className={iconButtonClass}
              disabled={summaryLoading || reviewsLoadingMore}
              onClick={loadMoreReviews}
            >
              {reviewsLoadingMore && <Spinner className='h-4 w-4' />}
              加载更多
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
