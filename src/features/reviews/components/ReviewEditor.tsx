'use client';

import {
  ChevronDown,
  Globe,
  Lock,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { OptionSwitchRow } from '@/components/OptionSwitchRow';
import Spinner from '@/components/Spinner';
import { RatingInput } from '@/features/reviews/components/RatingInput';
import type { VideoReviewDraft } from '@/features/reviews/hooks/useVideoReviews';
import { REVIEW_CONTENT_MAX_LENGTH } from '@/lib/video-reviews';

export interface ReviewEditorProps {
  initial: VideoReviewDraft | null;
  workTitle: string;
  onCancel?: () => void;
  onSubmit: (draft: VideoReviewDraft) => Promise<unknown>;
  variant?: 'inline' | 'modal';
}

const surfaceClass =
  'rounded-xl bg-white ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10';

const iconButtonClass =
  'inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100';

// 可见性与剧透收在同一入口，触发器直接显示当前状态
export function ReviewOptionsMenu({
  isPublic,
  spoiler,
  disabled,
  onPublicChange,
  onSpoilerChange,
  placement = 'top',
}: {
  isPublic: boolean;
  spoiler: boolean;
  disabled: boolean;
  onPublicChange: (next: boolean) => void;
  onSpoilerChange: (next: boolean) => void;
  placement?: 'top' | 'bottom';
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
          className={`absolute z-20 w-36 rounded-xl ${
            placement === 'top'
              ? 'bottom-full left-0 mb-2'
              : 'right-0 top-full mt-2'
          } bg-white p-1 shadow-lg shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/40 dark:ring-white/10`}
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

export function ContentCounter({ length }: { length: number }) {
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
  modal,
}: {
  saving: boolean;
  disabled: boolean;
  large?: boolean;
  modal?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      disabled={disabled}
      onClick={onClick}
      className={
        modal
          ? `${MODAL_PRIMARY_BUTTON_CLASS} gap-1.5`
          : `inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none dark:hover:bg-brand-500 dark:disabled:bg-white/[0.06] dark:disabled:text-gray-500 ${
              large ? 'h-9 px-5 text-sm' : 'h-8 px-3.5 text-xs'
            }`
      }
    >
      {saving && <Spinner className='h-3.5 w-3.5' />}
      保存
    </button>
  );
}

function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

export function ReviewEditor({
  initial,
  workTitle,
  onCancel,
  onSubmit,
  variant = 'inline',
}: ReviewEditorProps) {
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [content, setContent] = useState(initial?.content ?? '');
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false);
  const [spoiler, setSpoiler] = useState(initial?.spoiler ?? false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const modal = variant === 'modal';
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
    if (!canSubmit || savingRef.current) return;
    savingRef.current = true;
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
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleShortcut = (event: React.KeyboardEvent) => {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault();
    void submit();
  };

  const hintNode = error ? (
    <p role='alert' className='text-[11px] text-red-500'>
      {error}
    </p>
  ) : null;

  return (
    <>
      {!modal && (
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
              <RatingInput
                value={rating}
                onChange={setRating}
                disabled={saving}
              />
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
        </form>
      )}
      <ModalShell
        isOpen={modal || expanded}
        onClose={() => {
          if (modal) {
            if (!savingRef.current) onCancel?.();
          } else setExpanded(false);
        }}
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
              <h3
                className={
                  modal
                    ? `truncate ${MODAL_TITLE_CLASS}`
                    : 'truncate text-base font-semibold text-gray-900 dark:text-gray-50'
                }
              >
                {workTitle || '未命名作品'}
              </h3>
            </div>
            <button
              type='button'
              aria-label={modal ? '关闭编辑器' : '收起编辑器'}
              title={modal ? '关闭（Esc）' : '收起（Esc）'}
              className={
                modal
                  ? MODAL_CLOSE_BUTTON_CLASS
                  : `${iconButtonClass} h-9 w-9 px-0`
              }
              disabled={modal && saving}
              onClick={() => (modal ? onCancel?.() : setExpanded(false))}
            >
              {modal ? (
                <X className='h-4 w-4' />
              ) : (
                <Minimize2 className='h-4 w-4' />
              )}
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
            {modal && onCancel && (
              <button
                type='button'
                className={MODAL_SECONDARY_BUTTON_CLASS}
                disabled={saving}
                onClick={onCancel}
              >
                取消
              </button>
            )}
            <SaveButton
              modal={modal}
              saving={saving}
              disabled={!canSubmit}
              large
              onClick={() => void submit()}
            />
          </div>
        </div>
      </ModalShell>
    </>
  );
}
