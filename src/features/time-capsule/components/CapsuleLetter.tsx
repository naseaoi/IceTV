'use client';

import { ArrowRight, Play } from 'lucide-react';
import Link from 'next/link';

import { buildContinuePlayUrl } from '@/components/continue-card/play-url';
import CoverImage from '@/components/CoverImage';
import RatingStars from '@/components/RatingStars';
import { formatDeliveryDate } from '@/features/time-capsule/lib/capsules-client';
import type { DeliveredCapsule } from '@/features/time-capsule/types';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import { formatRating } from '@/lib/rating';

export type CapsuleLetterData = Pick<
  DeliveredCapsule,
  | 'title'
  | 'year'
  | 'cover'
  | 'source'
  | 'videoId'
  | 'content'
  | 'ratingThen'
  | 'ratingNow'
> & { writtenAt: number };

export function capsulePlayUrl(letter: CapsuleLetterData) {
  const playable =
    letter.source && letter.videoId && !isCatalogFavoriteSource(letter.source);
  return buildContinuePlayUrl({
    source: playable ? letter.source : '',
    id: playable ? letter.videoId : '',
    title: letter.title,
    year: letter.year,
  });
}

function RatingCompare({
  then,
  now,
}: {
  then: number | null;
  now: number | null;
}) {
  if (then === null && now === null) return null;
  const changed = then !== null && now !== null && then !== now;
  return (
    <div className='flex items-center gap-3 text-[13px] text-gray-500 dark:text-gray-400'>
      {then !== null && (
        <span className='inline-flex items-center gap-1.5'>
          当时
          <span className='font-semibold tabular-nums text-gray-900 dark:text-gray-100'>
            {formatRating(then)}
          </span>
        </span>
      )}
      {changed && <ArrowRight aria-hidden='true' className='h-3.5 w-3.5' />}
      {(changed || then === null) && now !== null && (
        <span className='inline-flex items-center gap-1.5'>
          现在
          <span className='font-semibold tabular-nums text-amber-600 dark:text-amber-400'>
            {formatRating(now)}
          </span>
        </span>
      )}
      <RatingStars
        value={(changed ? now : (then ?? now)) ?? 0}
        size='sm'
        decorative
      />
    </div>
  );
}

export function CapsuleLetter({
  letter,
  onNavigate,
}: {
  letter: CapsuleLetterData;
  onNavigate?: () => void;
}) {
  return (
    <article>
      <div className='flex items-center gap-3'>
        <div className='relative h-[60px] w-10 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800'>
          <CoverImage src={letter.cover} alt={letter.title} sizes='40px' />
        </div>
        <div className='min-w-0'>
          <p className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
            {letter.title}
          </p>
          <p className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
            写于 {formatDeliveryDate(letter.writtenAt)}
          </p>
        </div>
      </div>
      <div className='mt-4 rounded-2xl bg-gray-900/[0.03] px-5 py-5 ring-1 ring-inset ring-gray-900/[0.04] dark:bg-white/[0.04] dark:ring-white/[0.05]'>
        <p className='whitespace-pre-line break-words text-[15px] leading-7 text-gray-800 dark:text-gray-100'>
          {letter.content}
        </p>
      </div>
      <div className='mt-4 flex flex-wrap items-center justify-between gap-3'>
        <RatingCompare then={letter.ratingThen} now={letter.ratingNow} />
        <Link
          href={capsulePlayUrl(letter)}
          onClick={onNavigate}
          className='ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-gray-900 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
        >
          <Play aria-hidden='true' className='h-3.5 w-3.5 fill-current' />
          再看一遍
        </Link>
      </div>
    </article>
  );
}
