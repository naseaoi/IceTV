'use client';

import { HeartHandshake, Star, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { POSTER_BADGE_NEUTRAL_CLASS } from '@/components/poster-card-layout';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { socialRequest } from '@/lib/profile.client';
import { formatRating } from '@/lib/rating';
import type { PublicVideoReview } from '@/lib/types';

export interface TasteMatchResult {
  commonCount: number;
  // 共同评分不足时为 null
  score: number | null;
  picks: PublicVideoReview[];
}

function fetchTasteMatch(profileId: string) {
  return socialRequest<TasteMatchResult>(
    `/api/profile/taste-match?${new URLSearchParams({ profileId })}`,
  );
}

function playUrl(review: { title: string; year: string }) {
  return `/play?${new URLSearchParams({ title: review.title, year: review.year })}`;
}

function chipText(result: TasteMatchResult) {
  if (result.score !== null) return `口味相合 ${result.score}%`;
  if (result.commonCount > 0) return `共同评分 ${result.commonCount} 部`;
  return 'TA 的高分推荐';
}

// 只在他人主页挂载；放在资料统计行内，异步出现不推动下方内容
export function TasteMatchChip({
  profileId,
  nickname,
}: {
  profileId: string;
  nickname: string;
}) {
  const [result, setResult] = useState<TasteMatchResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchTasteMatch(profileId)
      .then((value) => {
        if (active) setResult(value);
      })
      // 辅助信息，失败时不展示入口
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [profileId]);

  if (!result || (result.commonCount === 0 && result.picks.length === 0)) {
    return null;
  }
  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='-my-1 inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-gray-900/[0.05] px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.08] hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-200 dark:hover:bg-white/[0.1] dark:hover:text-white'
      >
        <HeartHandshake className='h-3.5 w-3.5 text-brand-500 dark:text-brand-300' />
        <span className='tabular-nums'>{chipText(result)}</span>
      </button>
      <TasteMatchModal
        open={open}
        nickname={nickname}
        result={result}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const RING_RADIUS = 34;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ score }: { score: number }) {
  return (
    <div className='relative h-20 w-20 shrink-0'>
      <svg
        aria-hidden='true'
        viewBox='0 0 80 80'
        className='h-full w-full -rotate-90'
      >
        <circle
          cx='40'
          cy='40'
          r={RING_RADIUS}
          fill='none'
          strokeWidth='6'
          className='stroke-gray-900/[0.06] dark:stroke-white/[0.08]'
        />
        <circle
          cx='40'
          cy='40'
          r={RING_RADIUS}
          fill='none'
          strokeWidth='6'
          strokeLinecap='round'
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - score / 100)}
          className='stroke-brand-500'
        />
      </svg>
      <span className='absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-50'>
        {score}
        <span className='ml-px text-xs font-medium text-gray-500 dark:text-gray-400'>
          %
        </span>
      </span>
    </div>
  );
}

function TasteMatchModal({
  open,
  nickname,
  result,
  onClose,
}: {
  open: boolean;
  nickname: string;
  result: TasteMatchResult;
  onClose: () => void;
}) {
  const retained = useRetainedValue(open ? result : null);
  return (
    <ModalShell isOpen={open} onClose={onClose} panelClassName='max-w-md'>
      {retained && (
        <div className='flex max-h-[min(640px,85vh)] flex-col'>
          <div className='flex items-start justify-between gap-3 px-5 pb-2 pt-5'>
            <h2 className={`${MODAL_TITLE_CLASS} min-w-0 truncate`}>
              你和 {nickname} 的口味
            </h2>
            <button
              type='button'
              aria-label='关闭'
              onClick={onClose}
              className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5 -mt-1`}
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto px-5 pb-5'>
            {retained.commonCount > 0 && (
              <div className='mt-2 flex items-center gap-4 rounded-2xl bg-gray-900/[0.03] p-4 dark:bg-white/[0.04]'>
                {retained.score !== null && (
                  <ScoreRing score={retained.score} />
                )}
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {retained.score !== null ? '口味相合度' : '共同评分'}
                  </p>
                  <p className='mt-1 text-[13px] tabular-nums text-gray-500 dark:text-gray-400'>
                    你们都评过 {retained.commonCount} 部
                  </p>
                </div>
              </div>
            )}
            {retained.picks.length > 0 && (
              <section className='mt-5'>
                <h3 className='mb-3 text-[13px] font-medium text-gray-500 dark:text-gray-400'>
                  TA 打了高分、你还没看过
                </h3>
                <ul className='grid grid-cols-3 gap-x-3 gap-y-4'>
                  {retained.picks.map((pick) => (
                    <li key={`${pick.title_norm}:${pick.year}`}>
                      <Link
                        href={playUrl(pick)}
                        onClick={onClose}
                        className='group block'
                      >
                        <div className='relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800'>
                          <CoverImage
                            src={pick.cover}
                            alt={pick.title}
                            sizes='120px'
                          />
                          {pick.rating !== null && (
                            <span
                              className={`${POSTER_BADGE_NEUTRAL_CLASS} absolute right-1.5 top-1.5 gap-0.5`}
                            >
                              <Star
                                aria-hidden='true'
                                className='h-3 w-3 fill-amber-400 text-amber-400'
                              />
                              {formatRating(pick.rating)}
                            </span>
                          )}
                        </div>
                        <p className='mt-1.5 truncate text-[13px] font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400'>
                          {pick.title}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
