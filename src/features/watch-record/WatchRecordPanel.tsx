'use client';

import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import Spinner from '@/components/Spinner';
import {
  type WatchRecordTarget,
  WATCH_STATUS_OPTIONS,
} from '@/components/watch-record-context';
import type { FavoriteLibraryItem } from '@/features/favorites/lib/library-query';
import { RatingInput } from '@/features/reviews/components/RatingInput';
import {
  ContentCounter,
  ReviewOptionsMenu,
} from '@/features/reviews/components/ReviewEditor';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import {
  batchFavorites,
  deleteFavorite,
  generateStorageKey,
  getFavoriteForWork,
  saveFavorite,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';
import type { Favorite, FavoriteWatchStatus, VideoReview } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import { parseStorageKey } from '@/lib/utils';
import { REVIEW_CONTENT_MAX_LENGTH } from '@/lib/video-reviews';
import {
  deleteVideoReview,
  fetchMyVideoReview,
  saveVideoReview,
} from '@/lib/video-reviews.client';

// 骨架与表单共用的行高，保证加载完成时面板高度不变
const LABEL_ROW_CLASS = 'mb-2 flex h-6 items-center justify-between';
const LABEL_CLASS = 'text-[13px] font-medium text-gray-500 dark:text-gray-400';
const STATUS_TRACK_CLASS = 'h-10 rounded-xl';
// 状态行右侧放日期输入，比普通标题行略高
const STATUS_LABEL_ROW_CLASS =
  'mb-2 flex h-7 items-center justify-between gap-3';
const RATING_ROW_CLASS = 'h-9';
const CONTENT_FIELD_CLASS = 'h-28 rounded-xl';
const SAVE_BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-brand-600 px-5 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:pointer-events-none disabled:opacity-50';
const HINT_TEXT_CLASS = 'text-xs text-gray-400 dark:text-gray-500';
const LINK_BUTTON_CLASS =
  'inline-flex items-center gap-1 rounded-md text-xs text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100';

type StatusChoice = FavoriteWatchStatus | 'auto';

interface LoadedRecord {
  entry: FavoriteLibraryItem | null;
  review: VideoReview | null;
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 取当天正午，避免时区换算把日期推到前一天或后一天
function fromDateInputValue(value: string): number | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const timestamp = new Date(year, month - 1, day, 12).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function WatchRecordPanel({
  target,
  open,
  onClose,
}: {
  target: WatchRecordTarget;
  open: boolean;
  onClose: () => void;
}) {
  const year = target.year && target.year !== 'unknown' ? target.year : '';
  const [loaded, setLoaded] = useState<LoadedRecord | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const meta = [year, target.sourceName].filter(Boolean).join(' · ');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getFavoriteForWork({
        key: generateStorageKey(target.source, target.id),
        title: target.title,
        year,
      }),
      fetchMyVideoReview(target.title, year),
    ])
      .then(([entry, review]) => {
        if (!cancelled) setLoaded({ entry, review });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [target.source, target.id, target.title, year, attempt]);

  return (
    <ModalShell
      isOpen={open}
      onClose={onClose}
      closeOnBackdrop={!dirty}
      panelClassName='flex max-h-[min(90dvh,680px)] max-w-md flex-col overflow-hidden'
    >
      <div className='flex items-start gap-3 px-5 pb-4 pt-5'>
        <div className='min-w-0 flex-1'>
          <h2 className={`${MODAL_TITLE_CLASS} line-clamp-2`}>
            {target.title}
          </h2>
          {meta && (
            <p className='mt-0.5 truncate text-[13px] text-gray-500 dark:text-gray-400'>
              {meta}
            </p>
          )}
        </div>
        <button
          type='button'
          aria-label='关闭'
          onClick={onClose}
          className={`-mr-1.5 -mt-1 ${MODAL_CLOSE_BUTTON_CLASS}`}
        >
          <X aria-hidden='true' className='h-[18px] w-[18px]' />
        </button>
      </div>
      {loaded ? (
        <WatchRecordForm
          target={target}
          year={year}
          record={loaded}
          onDirtyChange={setDirty}
          onDone={onClose}
        />
      ) : (
        <WatchRecordSkeleton
          error={loadError}
          onRetry={() => {
            setLoadError(false);
            setAttempt((value) => value + 1);
          }}
        />
      )}
    </ModalShell>
  );
}

function WatchRecordSkeleton({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      <div
        role='status'
        aria-label={error ? undefined : '加载中'}
        className='relative space-y-4 px-5 pb-5'
      >
        <section>
          <div className={STATUS_LABEL_ROW_CLASS}>
            <span className={LABEL_CLASS}>观看状态</span>
          </div>
          <div className={`skeleton ${STATUS_TRACK_CLASS}`} />
        </section>
        <section>
          <div className={LABEL_ROW_CLASS}>
            <span className={LABEL_CLASS}>评分</span>
          </div>
          <div className={`skeleton w-56 rounded-lg ${RATING_ROW_CLASS}`} />
        </section>
        <section>
          <div className={LABEL_ROW_CLASS}>
            <span className={LABEL_CLASS}>短评</span>
          </div>
          <div className={`skeleton ${CONTENT_FIELD_CLASS}`} />
        </section>
        {error && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/80 dark:bg-gray-900/80'>
            <p
              role='alert'
              className='text-sm text-gray-600 dark:text-gray-300'
            >
              加载失败
            </p>
            <button
              type='button'
              onClick={onRetry}
              className={MODAL_SECONDARY_BUTTON_CLASS}
            >
              重试
            </button>
          </div>
        )}
      </div>
      <PanelFooter>
        <span />
        <button type='button' disabled className={SAVE_BUTTON_CLASS}>
          保存
        </button>
      </PanelFooter>
    </>
  );
}

function PanelFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 px-5 pb-4 pt-1'>
      {children}
    </div>
  );
}

function WatchRecordForm({
  target,
  year,
  record,
  onDirtyChange,
  onDone,
}: {
  target: WatchRecordTarget;
  year: string;
  record: LoadedRecord;
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}) {
  const { entry, review } = record;
  const catalog = isCatalogFavoriteSource(target.source);
  const [today] = useState(() => toDateInputValue(Date.now()));
  const initialChoice: StatusChoice = entry?.watchStatusManual
    ? entry.watchStatus
    : 'auto';
  const initialDate = entry?.watchedAt
    ? toDateInputValue(entry.watchedAt)
    : today;
  const [choice, setChoice] = useState<StatusChoice>(initialChoice);
  const [watchedDate, setWatchedDate] = useState(initialDate);
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [content, setContent] = useState(review?.content ?? '');
  const [isPublic, setIsPublic] = useState(review?.is_public ?? false);
  const [spoiler, setSpoiler] = useState(review?.spoiler ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const trimmed = content.trim();
  const effectiveStatus = choice === 'auto' ? entry?.watchStatus : choice;
  const statusDirty =
    choice !== initialChoice ||
    (choice === 'completed' && watchedDate !== initialDate);
  const reviewEmpty = rating === null && trimmed === '';
  const reviewDirty =
    rating !== (review?.rating ?? null) ||
    trimmed !== (review?.content ?? '') ||
    (!reviewEmpty &&
      (isPublic !== (review?.is_public ?? false) ||
        spoiler !== (review?.spoiler ?? false)));
  const dirty = statusDirty || reviewDirty;
  const canSave =
    dirty && !saving && trimmed.length <= REVIEW_CONTENT_MAX_LENGTH;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const buildFavorite = (fields: Partial<Favorite> = {}): Favorite => ({
    title: target.title,
    source_name: target.sourceName,
    year,
    cover: target.cover,
    total_episodes: target.totalEpisodes ?? (catalog ? 0 : 1),
    save_time: Date.now(),
    ...(target.searchTitle ? { search_title: target.searchTitle } : {}),
    ...(target.origin ? { origin: target.origin } : {}),
    ...fields,
  });

  const run = async (write: () => Promise<void>, successMessage?: string) => {
    setSaving(true);
    setError('');
    try {
      await write();
      if (successMessage) showToast(successMessage, 'success');
      onDirtyChange(false);
      onDone();
    } catch (error) {
      if (!isAbortError(error))
        setError(getErrorMessage(error, '保存失败，请重试'));
      setSaving(false);
      throw error;
    }
  };

  const save = () =>
    run(
      async () => {
        let inList = Boolean(entry);
        if (statusDirty) {
          const status = choice === 'auto' ? null : choice;
          const watchedAt =
            choice === 'completed'
              ? (fromDateInputValue(watchedDate) ?? Date.now())
              : undefined;
          if (entry) {
            await batchFavorites({
              action: 'set-status',
              target: { keys: [entry.key] },
              watchStatus: status,
              ...(watchedAt !== undefined ? { watchedAt } : {}),
            });
          } else if (status) {
            await saveFavorite(
              target.source,
              target.id,
              buildFavorite({
                watch_status: status,
                ...(watchedAt !== undefined ? { watched_at: watchedAt } : {}),
              }),
            );
            inList = true;
          }
        }
        if (!reviewDirty) return;
        if (reviewEmpty) {
          if (review)
            await deleteVideoReview(
              review.title,
              review.year,
              review.title_norm,
            );
          return;
        }
        await saveVideoReview({
          title: target.title,
          year,
          cover: target.cover,
          douban_id: target.doubanId ?? 0,
          source_key: catalog
            ? ''
            : generateStorageKey(target.source, target.id),
          rating,
          content: trimmed,
          is_public: isPublic,
          spoiler,
        });
        // 评价独立于收藏：作品未收藏时一并加入，状态由评分自动推导
        if (!inList) {
          await saveFavorite(target.source, target.id, buildFavorite());
        }
      },
      target.feedback?.watchStateVisible ? undefined : '观看记录已保存',
    );

  const removeEntry = () =>
    run(
      async () => {
        const parsed = entry && parseStorageKey(entry.key);
        if (parsed) await deleteFavorite(parsed.source, parsed.id);
      },
      target.feedback?.favoriteVisible ? undefined : '已移出收藏',
    );

  return (
    <>
      <form
        className='min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5'
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save().catch(() => {});
        }}
      >
        <section>
          <div className={STATUS_LABEL_ROW_CLASS}>
            <div className='flex min-w-0 items-center gap-2'>
              <span id='watch-record-status' className={LABEL_CLASS}>
                观看状态
              </span>
              {choice !== 'auto' ? (
                <button
                  type='button'
                  disabled={saving}
                  onClick={() => {
                    setChoice('auto');
                    setWatchedDate(initialDate);
                  }}
                  className={LINK_BUTTON_CLASS}
                >
                  <RotateCcw aria-hidden='true' className='h-3 w-3' />
                  {entry ? '恢复自动' : '清除'}
                </button>
              ) : (
                entry && <span className={HINT_TEXT_CLASS}>自动</span>
              )}
            </div>
            {effectiveStatus === 'completed' && (
              <label className='flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400'>
                看过于
                <input
                  type='date'
                  value={watchedDate}
                  max={today}
                  disabled={saving}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setWatchedDate(event.target.value);
                    setChoice('completed');
                  }}
                  className='h-7 rounded-md border-0 bg-gray-900/[0.04] px-2 py-0 text-xs tabular-nums text-gray-900 ring-1 ring-inset ring-gray-900/[0.08] focus:ring-2 focus:ring-brand-500 disabled:opacity-60 dark:bg-white/[0.06] dark:text-gray-100 dark:ring-white/[0.08] dark:[color-scheme:dark]'
                />
              </label>
            )}
          </div>
          <div
            role='radiogroup'
            aria-labelledby='watch-record-status'
            className={`grid grid-cols-3 gap-1 bg-gray-900/[0.05] p-1 dark:bg-white/[0.06] ${STATUS_TRACK_CLASS}`}
          >
            {WATCH_STATUS_OPTIONS.map((option) => {
              const active = option.value === effectiveStatus;
              return (
                <button
                  key={option.value}
                  type='button'
                  role='radio'
                  aria-checked={active}
                  disabled={saving}
                  onClick={() => setChoice(option.value)}
                  className={`rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.14] dark:text-white'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className={LABEL_ROW_CLASS}>
            <span className={LABEL_CLASS}>评分</span>
            {rating !== null && (
              <button
                type='button'
                disabled={saving}
                onClick={() => setRating(null)}
                className={LINK_BUTTON_CLASS}
              >
                清除
              </button>
            )}
          </div>
          <div className={`flex items-center ${RATING_ROW_CLASS}`}>
            <RatingInput
              value={rating}
              onChange={setRating}
              disabled={saving}
            />
          </div>
        </section>

        <section>
          <div className={LABEL_ROW_CLASS}>
            <label htmlFor='watch-record-content' className={LABEL_CLASS}>
              短评
            </label>
            <ReviewOptionsMenu
              isPublic={isPublic}
              spoiler={spoiler}
              disabled={saving}
              onPublicChange={setIsPublic}
              onSpoilerChange={setSpoiler}
              placement='bottom'
            />
          </div>
          <div className='relative'>
            <textarea
              id='watch-record-content'
              value={content}
              disabled={saving}
              placeholder='说说你的看法（可选）'
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (canSave) void save().catch(() => {});
                }
              }}
              className={`block w-full resize-none border-0 bg-gray-900/[0.04] px-3.5 pb-6 pt-3 text-sm leading-relaxed text-gray-900 ring-1 ring-inset ring-gray-900/[0.08] placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-500 disabled:opacity-60 dark:bg-white/[0.06] dark:text-gray-100 dark:ring-white/[0.08] dark:placeholder:text-gray-500 dark:focus:bg-gray-900 ${CONTENT_FIELD_CLASS}`}
            />
            <span className='pointer-events-none absolute bottom-2 right-3'>
              <ContentCounter length={trimmed.length} />
            </span>
          </div>
        </section>
      </form>

      <PanelFooter>
        {error ? (
          <p role='alert' className='min-w-0 truncate text-sm text-rose-500'>
            {error}
          </p>
        ) : entry ? (
          <button
            type='button'
            disabled={saving}
            onClick={() => setConfirmRemove(true)}
            className='-ml-3 inline-flex h-9 items-center rounded-full px-3 text-[13px] text-gray-500 transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50 dark:text-gray-400'
          >
            移出收藏
          </button>
        ) : (
          <span />
        )}
        <button
          type='button'
          disabled={!canSave}
          onClick={() => void save().catch(() => {})}
          className={SAVE_BUTTON_CLASS}
        >
          {saving && <Spinner className='h-3 w-3' />}
          保存
        </button>
      </PanelFooter>

      <ConfirmModal
        isOpen={confirmRemove}
        title='移出收藏？'
        message={`「${target.title}」的观看状态会一并移除，评价会保留。`}
        danger
        cancelText='再想想'
        confirmText='移出'
        onCancel={() => setConfirmRemove(false)}
        onConfirm={async () => {
          await removeEntry();
        }}
      />
    </>
  );
}
