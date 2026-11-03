'use client';

import {
  Globe,
  LoaderCircle,
  Lock,
  Maximize2,
  Minimize2,
  PencilLine,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import ExpandableText from '@/components/ExpandableText';
import ModalShell from '@/components/modals/ModalShell';
import RatingBadge from '@/components/RatingBadge';
import RatingStars from '@/components/RatingStars';
import { RatingInput } from '@/features/play/components/EpisodeSelector/RatingInput';
import type { VideoReviewsState } from '@/features/play/hooks/useVideoReviews';
import { formatRating } from '@/lib/rating';
import { formatRelativeTime } from '@/lib/relative-time';
import type { PublicVideoReview, VideoReview } from '@/lib/types';
import { REVIEW_CONTENT_MAX_LENGTH } from '@/lib/video-reviews.client';

interface ReviewsTabProps {
  workTitle: string;
  reviews: VideoReviewsState;
  favorited: boolean;
  onAddFavorite?: () => void;
  // 简介区评分入口跳转过来时为 true，处理后经回调复位
  editRequested: boolean;
  onEditRequestHandled: () => void;
}

interface ReviewDraft {
  rating: number | null;
  content: string;
  is_public: boolean;
}

const surfaceClass =
  'rounded-2xl bg-white ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10';

const iconButtonClass =
  'inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100';

const AVATAR_GRADIENTS = [
  'from-sky-400 to-blue-600',
  'from-violet-400 to-purple-600',
  'from-rose-400 to-pink-600',
  'from-amber-400 to-orange-600',
  'from-teal-400 to-cyan-600',
  'from-lime-400 to-green-600',
];

function avatarGradient(username: string): string {
  let hash = 0;
  for (const char of username) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className='flex min-h-8 items-center gap-2'>
      <h4 className='text-[13px] font-semibold text-gray-900 dark:text-gray-100'>
        {title}
      </h4>
      {count !== undefined && count > 0 && (
        <span className='text-xs tabular-nums text-gray-400 dark:text-gray-500'>
          {count}
        </span>
      )}
      {children && (
        <div className='ml-auto flex items-center gap-1'>{children}</div>
      )}
    </div>
  );
}

function VisibilityToggle({
  isPublic,
  disabled,
  onChange,
}: {
  isPublic: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={isPublic}
      aria-label='公开评价'
      disabled={disabled}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        isPublic
          ? 'bg-green-500/10 text-green-700 ring-1 ring-inset ring-green-500/25 dark:text-green-300'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10'
      }`}
      onClick={() => onChange(!isPublic)}
    >
      {isPublic ? (
        <Globe aria-hidden='true' className='h-3.5 w-3.5' />
      ) : (
        <Lock aria-hidden='true' className='h-3.5 w-3.5' />
      )}
      {isPublic ? '公开' : '仅自己可见'}
    </button>
  );
}

function ContentCounter({ length }: { length: number }) {
  if (length === 0) return null;
  const nearLimit = length > REVIEW_CONTENT_MAX_LENGTH * 0.9;
  const overLimit = length > REVIEW_CONTENT_MAX_LENGTH;
  return (
    <span
      className={`shrink-0 text-[11px] tabular-nums ${
        overLimit ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'
      }`}
    >
      {nearLimit ? `${length}/${REVIEW_CONTENT_MAX_LENGTH}` : `${length} 字`}
    </span>
  );
}

function SaveButton({
  saving,
  disabled,
  large,
  onClick,
}: {
  saving: boolean;
  disabled: boolean;
  large?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-green-600 font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none dark:hover:bg-green-500 dark:disabled:bg-white/[0.06] dark:disabled:text-gray-500 ${
        large ? 'h-9 px-5 text-sm' : 'h-8 px-3.5 text-xs'
      }`}
    >
      {saving && <LoaderCircle className='h-3.5 w-3.5 animate-spin' />}
      保存
    </button>
  );
}

function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

function ReviewEditor({
  initial,
  favorited,
  workTitle,
  onCancel,
  onSubmit,
}: {
  initial: VideoReview | null;
  favorited: boolean;
  workTitle: string;
  onCancel?: () => void;
  onSubmit: (draft: ReviewDraft) => Promise<void>;
}) {
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [content, setContent] = useState(initial?.content ?? '');
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const fullTextareaRef = useRef<HTMLTextAreaElement>(null);
  // 仅在打开展开编辑器后的首次聚焦把光标移到末尾，之后尊重用户点击位置
  const caretToEndRef = useRef(false);

  const trimmedLength = content.trim().length;
  const canSubmit =
    !saving &&
    (rating !== null || trimmedLength > 0) &&
    trimmedLength <= REVIEW_CONTENT_MAX_LENGTH;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({ rating, content: content.trim(), is_public: isPublic });
    } catch {
      setError('保存失败，请稍后重试');
      setSaving(false);
    }
  };

  const handleShortcut = (event: React.KeyboardEvent) => {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault();
    void submit();
  };

  const hint = error || (!favorited && !initial ? '保存后将同时加入收藏' : '');
  const hintNode = hint ? (
    <p
      role={error ? 'alert' : undefined}
      className={`text-[11px] ${
        error ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'
      }`}
    >
      {hint}
    </p>
  ) : null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className='space-y-2'
    >
      <div
        className={`${surfaceClass} transition-shadow focus-within:ring-2 focus-within:ring-green-500/40`}
      >
        <div className='flex items-center justify-between gap-2 px-3.5 pt-3.5'>
          <RatingInput value={rating} onChange={setRating} disabled={saving} />
          {rating !== null && (
            <button
              type='button'
              aria-label='清除评分'
              title='清除评分'
              className={`${iconButtonClass} w-8 px-0`}
              disabled={saving}
              onClick={() => setRating(null)}
            >
              <X className='h-4 w-4' />
            </button>
          )}
        </div>

        <textarea
          aria-label='评价内容'
          value={content}
          disabled={saving}
          placeholder='说说你的看法（可选）'
          className='block max-h-60 min-h-[5.5rem] w-full resize-none border-0 bg-transparent px-3.5 py-3 text-sm leading-relaxed text-gray-800 outline-none [field-sizing:content] placeholder:text-gray-400 focus:ring-0 disabled:opacity-60 dark:text-gray-100 dark:placeholder:text-gray-500'
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={handleShortcut}
        />

        <div className='flex items-center gap-1.5 border-t border-gray-100 px-2.5 py-2 dark:border-white/[0.06]'>
          <VisibilityToggle
            isPublic={isPublic}
            disabled={saving}
            onChange={setIsPublic}
          />
          <button
            type='button'
            aria-label='展开编辑'
            title='展开编辑'
            className={`${iconButtonClass} w-8 px-0`}
            disabled={saving}
            onClick={() => {
              caretToEndRef.current = true;
              setExpanded(true);
            }}
          >
            <Maximize2 className='h-3.5 w-3.5' />
          </button>
          <span className='ml-auto' />
          <ContentCounter length={trimmedLength} />
          {onCancel && (
            <button
              type='button'
              className={iconButtonClass}
              disabled={saving}
              onClick={onCancel}
            >
              取消
            </button>
          )}
          <SaveButton saving={saving} disabled={!canSubmit} />
        </div>
      </div>

      {hintNode && <div className='px-1'>{hintNode}</div>}

      <ModalShell
        isOpen={expanded}
        onClose={() => setExpanded(false)}
        closeOnBackdrop={false}
        initialFocusRef={fullTextareaRef}
        backdropClassName='bg-black/40 backdrop-blur-[2px]'
        panelClassName='flex h-[min(88dvh,820px)] max-w-3xl flex-col overflow-hidden !bg-white dark:!bg-gray-900'
      >
        <div
          role='dialog'
          aria-modal='true'
          aria-label='编辑评价'
          className='flex min-h-0 flex-1 flex-col'
        >
          <div className='flex items-center gap-3 px-5 pt-4 sm:px-7 sm:pt-5'>
            <div className='min-w-0 flex-1'>
              <p className='text-[11px] font-medium tracking-wider text-gray-400 dark:text-gray-500'>
                {initial ? '编辑评价' : '写评价'}
              </p>
              <h3 className='truncate text-base font-semibold text-gray-900 dark:text-gray-50'>
                {workTitle || '未命名作品'}
              </h3>
            </div>
            <button
              type='button'
              aria-label='收起编辑器'
              title='收起（Esc）'
              className={`${iconButtonClass} h-9 w-9 px-0`}
              onClick={() => setExpanded(false)}
            >
              <Minimize2 className='h-4 w-4' />
            </button>
          </div>

          <div className='px-5 py-4 sm:px-7'>
            <RatingInput
              value={rating}
              onChange={setRating}
              disabled={saving}
            />
          </div>

          <textarea
            aria-label='评价全文'
            value={content}
            ref={fullTextareaRef}
            disabled={saving}
            placeholder='写下完整的感受，可以分段……'
            className='min-h-0 flex-1 resize-none border-0 border-t border-gray-100 bg-transparent px-5 py-5 text-[15px] leading-8 text-gray-800 outline-none placeholder:text-gray-400 focus:ring-0 dark:border-white/[0.06] dark:text-gray-100 dark:placeholder:text-gray-500 sm:px-7'
            onFocus={(event) => {
              if (!caretToEndRef.current) return;
              caretToEndRef.current = false;
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
            }}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={handleShortcut}
          />

          <div className='flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-3 dark:border-white/[0.06] sm:px-6'>
            <VisibilityToggle
              isPublic={isPublic}
              disabled={saving}
              onChange={setIsPublic}
            />
            {hintNode}
            <span className='ml-auto' />
            <ContentCounter length={trimmedLength} />
            <span className='hidden text-[11px] text-gray-400 dark:text-gray-500 sm:inline'>
              Ctrl + Enter 保存
            </span>
            <SaveButton
              saving={saving}
              disabled={!canSubmit}
              large
              onClick={() => void submit()}
            />
          </div>
        </div>
      </ModalShell>
    </form>
  );
}

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
              <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
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

function PublicReviewItem({
  review,
  isMine,
}: {
  review: PublicVideoReview;
  isMine: boolean;
}) {
  return (
    <li className='flex gap-3 py-3.5 first:pt-0 last:pb-0'>
      <span
        aria-hidden='true'
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[13px] font-semibold text-white ${avatarGradient(
          review.username,
        )}`}
      >
        {review.username.slice(0, 1).toUpperCase()}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='min-w-0 truncate text-[13px] font-medium text-gray-900 dark:text-gray-100'>
            {review.username}
          </span>
          {isMine && (
            <span className='shrink-0 rounded px-1 text-[10px] font-medium text-green-700 ring-1 ring-inset ring-green-500/30 dark:text-green-300'>
              我
            </span>
          )}
          <span className='shrink-0 text-[11px] text-gray-400 dark:text-gray-500'>
            {formatRelativeTime(review.updated_at)}
          </span>
          {review.rating !== null && (
            <RatingBadge value={review.rating} className='ml-auto shrink-0' />
          )}
        </div>
        {review.content && (
          <div className='mt-1'>
            <ExpandableText
              text={review.content}
              className='text-[13px] leading-[1.7] text-gray-600 dark:text-gray-400'
            />
          </div>
        )}
      </div>
    </li>
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
  } = reviews;
  const [editing, setEditing] = useState(false);
  const { session } = useAuthSession();
  const username = session.status === 'authenticated' ? session.username : null;

  useEffect(() => {
    if (!editRequested) return;
    setEditing(true);
    onEditRequestHandled();
  }, [editRequested, onEditRequestHandled]);

  const handleSubmit = async (draft: ReviewDraft) => {
    if (!favorited) onAddFavorite?.();
    await save(draft);
    setEditing(false);
  };

  const showEditor = editing || (!myReview && !myReviewLoading);
  const average = summary?.average ?? null;

  return (
    <div className='min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-4 sm:p-5'>
      <section
        aria-label='评分概览'
        className='flex items-center gap-4 border-b border-gray-100 pb-5 dark:border-white/[0.06]'
      >
        {summaryLoading && !summary ? (
          <LoaderCircle className='h-5 w-5 animate-spin text-gray-400' />
        ) : (
          <>
            <span
              className={`text-[2.5rem] font-semibold tabular-nums leading-none tracking-tight ${
                average !== null
                  ? 'text-gray-900 dark:text-gray-50'
                  : 'text-gray-300 dark:text-gray-600'
              }`}
            >
              {average !== null ? formatRating(average) : '—'}
            </span>
            <div className='space-y-1'>
              <RatingStars value={average} size='md' decorative />
              <p className='text-xs text-gray-500 dark:text-gray-400'>
                {summaryError
                  ? '评分加载失败'
                  : average !== null
                    ? `${summary?.count ?? 0} 人公开评分`
                    : '暂无公开评分'}
              </p>
            </div>
          </>
        )}
      </section>

      <section className='space-y-2'>
        <SectionHeader title='我的评价' />
        {myReviewLoading && !myReview ? (
          <div className='flex justify-center py-6'>
            <LoaderCircle className='h-5 w-5 animate-spin text-gray-400' />
          </div>
        ) : showEditor ? (
          <ReviewEditor
            key={myReview?.updated_at ?? 'new'}
            initial={myReview}
            favorited={favorited}
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
        <SectionHeader title='大家的评价' count={summary?.reviews.length}>
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
        </SectionHeader>
        {summary && summary.reviews.length > 0 ? (
          <ul className='divide-y divide-gray-100 dark:divide-white/[0.06]'>
            {summary.reviews.map((review) => (
              <PublicReviewItem
                key={review.username}
                review={review}
                isMine={review.username === username}
              />
            ))}
          </ul>
        ) : (
          !summaryLoading &&
          !summaryError && (
            <p className='py-3 text-center text-xs text-gray-400 dark:text-gray-500'>
              还没有公开评价，来写第一条吧
            </p>
          )
        )}
      </section>
    </div>
  );
};
