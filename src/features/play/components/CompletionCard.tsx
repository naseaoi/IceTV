'use client';

import { ListPlus, Mail, PartyPopper, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import { useOpenListPicker } from '@/components/list-picker-context';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import { durationParts } from '@/features/annual-report/lib/format';
import { useFollowedOpinions } from '@/features/play/components/EpisodeSelector/FollowedOpinions';
import {
  fetchCompletion,
  markCompletionCelebrated,
} from '@/features/play/lib/completion-client';
import type { CompletionSummary } from '@/features/play/lib/completion-types';
import { RatingInput } from '@/features/reviews/components/RatingInput';
import {
  type CapsuleTarget,
  CapsuleComposerModal,
} from '@/features/time-capsule/components/CapsuleComposer';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { generateStorageKey } from '@/lib/db.client';
import type { VideoReview } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import {
  fetchMyVideoReview,
  saveVideoReview,
} from '@/lib/video-reviews.client';

export interface CompletionTarget {
  source: string;
  id: string;
  doubanId: number;
}

// 播放统计在结束事件后才上报最后一段，稍等再读取汇总
const SUMMARY_DELAY_MS = 1200;
const DAY_MS = 24 * 60 * 60 * 1000;
const STACK_LIMIT = 3;

const ACTION_BUTTON_CLASS =
  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-gray-900/[0.05] px-3 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.09] dark:bg-white/[0.07] dark:text-gray-200 dark:hover:bg-white/[0.12]';

type Loaded = {
  target: CompletionTarget;
  summary: CompletionSummary;
  review: VideoReview | null;
};

// 每次最后一集播完时由播放页传入目标；已展示过的作品不再弹出
export function CompletionCard({
  target,
  favorited,
  onAddFavorite,
  onClose,
}: {
  target: CompletionTarget | null;
  favorited: boolean;
  onAddFavorite: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!target) return;
    let active = true;
    const timer = window.setTimeout(() => {
      fetchCompletion(target.source, target.id)
        .then(async (summary) => {
          if (!active) return;
          if (summary.celebrated) {
            onClose();
            return;
          }
          const review = await fetchMyVideoReview(
            summary.title,
            summary.year,
          ).catch(() => null);
          if (!active) return;
          setLoaded({ target, summary, review });
          void markCompletionCelebrated(target.source, target.id).catch(
            () => undefined,
          );
        })
        .catch(() => {
          if (active) onClose();
        });
    }, SUMMARY_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onClose, target]);

  const open = Boolean(target && loaded);
  const retained = useRetainedValue(open ? loaded : null);

  return (
    <ModalShell
      isOpen={open}
      onClose={() => {
        setLoaded(null);
        onClose();
      }}
      panelClassName='max-w-sm overflow-hidden'
      closeOnBackdrop={false}
    >
      {retained && (
        <CompletionContent
          key={`${retained.target.source}+${retained.target.id}`}
          target={retained.target}
          summary={retained.summary}
          review={retained.review}
          favorited={favorited}
          onAddFavorite={onAddFavorite}
          onClose={() => {
            setLoaded(null);
            onClose();
          }}
        />
      )}
    </ModalShell>
  );
}

function formatWatchTime(seconds: number) {
  const { hours, minutes } = durationParts(seconds);
  if (hours === 0) return { value: String(Math.max(minutes, 1)), unit: '分钟' };
  if (hours >= 10 || minutes === 0)
    return { value: String(hours), unit: '小时' };
  return { value: `${hours}.${Math.floor(minutes / 6)}`, unit: '小时' };
}

function spanDays(summary: CompletionSummary) {
  if (!summary.firstWatchedAt) return null;
  const start = new Date(summary.firstWatchedAt);
  const end = new Date(summary.completedAt);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function Stat({
  value,
  unit,
  label,
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div className='min-w-0 flex-1 text-center'>
      <p className='text-gray-900 dark:text-gray-50'>
        <span className='text-2xl font-semibold tabular-nums tracking-tight'>
          {value}
        </span>
        <span className='ml-0.5 text-xs text-gray-500 dark:text-gray-400'>
          {unit}
        </span>
      </p>
      <p className='mt-0.5 text-[11px] text-gray-500 dark:text-gray-400'>
        {label}
      </p>
    </div>
  );
}

function CompletionContent({
  target,
  summary,
  review,
  favorited,
  onAddFavorite,
  onClose,
}: {
  target: CompletionTarget;
  summary: CompletionSummary;
  review: VideoReview | null;
  favorited: boolean;
  onAddFavorite: () => Promise<void> | void;
  onClose: () => void;
}) {
  const openListPicker = useOpenListPicker();
  const followed = useFollowedOpinions(summary.title, summary.year);
  const followedWatched =
    followed?.items.filter((item) => item.status === 'completed') ?? [];
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [capsuleTarget, setCapsuleTarget] = useState<CapsuleTarget | null>(
    null,
  );

  const watchTime = formatWatchTime(summary.totalWatchSeconds);
  const days = spanDays(summary);
  const ratingDirty = rating !== null && rating !== (review?.rating ?? null);

  async function finish() {
    if (!ratingDirty) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveVideoReview({
        title: summary.title,
        year: summary.year,
        cover: summary.cover,
        douban_id: target.doubanId,
        source_key: generateStorageKey(target.source, target.id),
        rating,
        content: review?.content ?? '',
        is_public: review?.is_public ?? false,
        spoiler: review?.spoiler ?? false,
      });
      // 评价独立于收藏：未收藏时一并加入，状态由评分推导为看过
      if (!favorited) await onAddFavorite();
      onClose();
    } catch (saveError) {
      if (!isAbortError(saveError)) {
        setError(getErrorMessage(saveError, '评分保存失败，请重试'));
      }
      setSaving(false);
    }
  }

  return (
    <div className='relative'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden opacity-40 dark:opacity-50'
      >
        <div className='absolute -inset-10 blur-3xl'>
          <CoverImage
            src={summary.cover}
            alt=''
            sizes='96px'
            fallbackLabel=''
          />
        </div>
        <div className='absolute inset-0 bg-gradient-to-b from-transparent to-white dark:to-gray-900' />
      </div>
      <button
        type='button'
        aria-label='关闭'
        onClick={onClose}
        className={`${MODAL_CLOSE_BUTTON_CLASS} absolute right-3 top-3 z-10`}
      >
        <X className='h-5 w-5' />
      </button>
      <div className='relative px-6 pb-6 pt-8 text-center'>
        <div className='relative mx-auto aspect-[2/3] w-28 overflow-hidden rounded-xl bg-gray-200 shadow-xl shadow-black/25 ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10'>
          <CoverImage
            src={summary.cover}
            alt={summary.title}
            sizes='112px'
            priority
          />
        </div>
        <p className='mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 dark:text-brand-400'>
          <PartyPopper aria-hidden='true' className='h-4 w-4' />
          看完了
        </p>
        <h2 className='mt-1 line-clamp-2 text-xl font-semibold leading-snug text-gray-900 dark:text-gray-50'>
          {summary.title}
        </h2>

        <div className='mt-5 flex items-start divide-x divide-gray-900/[0.06] dark:divide-white/[0.08]'>
          <Stat
            value={watchTime.value}
            unit={watchTime.unit}
            label='观看时长'
          />
          {days !== null && days > 1 && (
            <Stat value={String(days)} unit='天' label='从开始到看完' />
          )}
          {summary.episodes > 1 && (
            <Stat value={String(summary.episodes)} unit='集' label='全部看完' />
          )}
        </div>

        {followedWatched.length > 0 && (
          <p className='mt-5 inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
            <span className='flex -space-x-1.5'>
              {followedWatched.slice(0, STACK_LIMIT).map((item) => (
                <ProfileAvatar
                  key={item.author.profileId}
                  user={item.author}
                  className='h-5 w-5 rounded-full ring-2 ring-white dark:ring-gray-900'
                />
              ))}
            </span>
            关注的 {followedWatched.length} 人也看过
          </p>
        )}

        <div className='mt-6 rounded-2xl bg-gray-900/[0.03] px-4 py-4 dark:bg-white/[0.04]'>
          <p className='text-[13px] font-medium text-gray-700 dark:text-gray-300'>
            {review?.rating ? '你的评分' : '给它打个分'}
          </p>
          <div className='mt-2 flex justify-center'>
            <RatingInput
              value={rating}
              onChange={setRating}
              disabled={saving}
            />
          </div>
        </div>

        <div className='mt-3 flex gap-2'>
          {openListPicker && (
            <button
              type='button'
              className={ACTION_BUTTON_CLASS}
              onClick={() =>
                openListPicker({
                  source: target.source,
                  id: target.id,
                  title: summary.title,
                  year: summary.year,
                  cover: summary.cover,
                })
              }
            >
              <ListPlus aria-hidden='true' className='h-4 w-4' />
              加入片单
            </button>
          )}
          <button
            type='button'
            className={ACTION_BUTTON_CLASS}
            onClick={() =>
              setCapsuleTarget({
                title: summary.title,
                year: summary.year,
                cover: summary.cover,
                source: target.source,
                videoId: target.id,
              })
            }
          >
            <Mail aria-hidden='true' className='h-4 w-4' />
            写给未来的自己
          </button>
        </div>

        {error && (
          <p role='alert' className='mt-3 text-[13px] text-red-500'>
            {error}
          </p>
        )}

        <button
          type='button'
          disabled={saving}
          onClick={() => void finish()}
          className={`${MODAL_PRIMARY_BUTTON_CLASS} mt-5 w-full`}
        >
          {ratingDirty ? '保存评分' : '完成'}
        </button>
      </div>
      <CapsuleComposerModal
        target={capsuleTarget}
        onClose={() => setCapsuleTarget(null)}
      />
    </div>
  );
}
