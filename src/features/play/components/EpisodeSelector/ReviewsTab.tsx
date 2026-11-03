'use client';

import {
  ChevronDown,
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
import React, { useEffect, useId, useRef, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import ExpandableText from '@/components/ExpandableText';
import ModalShell from '@/components/modals/ModalShell';
import PublicReviewContent from '@/components/PublicReviewContent';
import RatingStars from '@/components/RatingStars';
import { RatingInput } from '@/features/play/components/EpisodeSelector/RatingInput';
import ReviewDistribution from '@/features/play/components/EpisodeSelector/ReviewDistribution';
import type { VideoReviewsState } from '@/features/play/hooks/useVideoReviews';
import { formatRating } from '@/lib/rating';
import { formatRelativeTime } from '@/lib/relative-time';
import type { VideoReview } from '@/lib/types';
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
  spoiler: boolean;
}

const surfaceClass =
  'rounded-2xl bg-white ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10';

const iconButtonClass =
  'inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100';

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

function OptionSwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      className='flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'
      onClick={() => onChange(!checked)}
    >
      {label}
      <span
        aria-hidden='true'
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}

// 可见性与剧透收在同一入口，触发器直接显示当前状态
function ReviewOptionsMenu({
  isPublic,
  spoiler,
  disabled,
  onPublicChange,
  onSpoilerChange,
}: {
  isPublic: boolean;
  spoiler: boolean;
  disabled: boolean;
  onPublicChange: (next: boolean) => void;
  onSpoilerChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={containerRef}
      className='relative'
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // 阻止冒泡到展开编辑器的 Esc 关闭
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type='button'
        aria-label='评价设置'
        aria-haspopup='true'
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-3 pr-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isPublic
            ? 'bg-brand-500/10 text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-300'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10'
        }`}
        onClick={() => setOpen((value) => !value)}
      >
        {isPublic ? (
          <Globe aria-hidden='true' className='h-3.5 w-3.5' />
        ) : (
          <Lock aria-hidden='true' className='h-3.5 w-3.5' />
        )}
        {isPublic ? '公开' : '仅自己可见'}
        {spoiler && (
          <>
            <span aria-hidden='true' className='opacity-50'>
              ·
            </span>
            含剧透
          </>
        )}
        <ChevronDown
          aria-hidden='true'
          className={`h-3.5 w-3.5 opacity-60 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div
          id={menuId}
          role='group'
          aria-label='评价设置'
          className='absolute bottom-full left-0 z-20 mb-2 w-52 rounded-xl bg-white p-1 shadow-lg shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/40 dark:ring-white/10'
        >
          <OptionSwitchRow
            label='公开评价'
            checked={isPublic}
            onChange={onPublicChange}
          />
          <OptionSwitchRow
            label='包含剧透'
            checked={spoiler}
            onChange={onSpoilerChange}
          />
        </div>
      )}
    </div>
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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none dark:hover:bg-brand-500 dark:disabled:bg-white/[0.06] dark:disabled:text-gray-500 ${
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
  const [spoiler, setSpoiler] = useState(initial?.spoiler ?? false);
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
      await onSubmit({
        rating,
        content: content.trim(),
        is_public: isPublic,
        spoiler,
      });
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
        className={`${surfaceClass} transition-shadow focus-within:ring-2 focus-within:ring-brand-500/40`}
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

        <div className='flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-2.5 py-2 dark:border-white/[0.06]'>
          <ReviewOptionsMenu
            isPublic={isPublic}
            spoiler={spoiler}
            disabled={saving}
            onPublicChange={setIsPublic}
            onSpoilerChange={setSpoiler}
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
        backdropClassName='bg-black/50'
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
            <ReviewOptionsMenu
              isPublic={isPublic}
              spoiler={spoiler}
              disabled={saving}
              onPublicChange={setIsPublic}
              onSpoilerChange={setSpoiler}
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
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;

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
      {summary && <ReviewDistribution distribution={summary.distribution} />}

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
            <p className='py-3 text-center text-xs text-gray-400 dark:text-gray-500'>
              还没有公开评价，来写第一条吧
            </p>
          )
        )}
      </section>
    </div>
  );
};
