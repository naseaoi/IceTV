'use client';

import { Heart, Star } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  Figure,
  Kicker,
  Lead,
  RECAP_RULE,
  RECAP_TEXT,
  RecapBackdrop,
  RecapCover,
  Rise,
  SlideBody,
} from '@/features/annual-report/components/RecapPrimitives';
import type { SlideProps } from '@/features/annual-report/components/slides/OverviewSlides';
import { formatInstantDate } from '@/features/annual-report/lib/format';
import { listUrl } from '@/features/lists/lib/list-links';

type CoverWork = { title: string; cover: string };

// 片单封面叠放，排在前面的压在上层
const STACK = ['z-30', '-ml-7 z-20', '-ml-7 z-10'];

// 封面 + 小标注 + 片名 + 说明，几页共用的作品行
function WorkRow({
  d,
  work,
  label,
  children,
  className = '',
}: {
  d: number;
  work: CoverWork;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Rise d={d} className={`flex items-center gap-5 py-5 ${className}`}>
      <RecapCover
        cover={work.cover}
        title={work.title}
        className='w-14 rounded-md'
        sizes='72px'
      />
      <div className='min-w-0'>
        <div className={`text-xs ${RECAP_TEXT.muted}`}>{label}</div>
        <div className='mt-1 line-clamp-2 text-[17px] font-medium leading-snug'>
          {work.title}
        </div>
        <div className={`mt-1.5 text-[13px] ${RECAP_TEXT.secondary}`}>
          {children}
        </div>
      </div>
    </Rise>
  );
}

export function CompletionsSlide({ report, audience }: SlideProps) {
  const { count, longest, fastest } = report.completions!;
  const work = longest!;
  const date = (at: number) =>
    formatInstantDate(at, report.timeZone, report.year);
  const showFastest = fastest && fastest.title !== work.title;
  return (
    <>
      <RecapBackdrop tint='sage' at='bottom-right' />
      <SlideBody center>
        <Kicker>Completed</Kicker>
        <Lead d={1} className='mt-6'>
          这一年，{audience.you}完整看完了
        </Lead>
        <Rise d={2} className='mt-3'>
          <Figure value={count} unit='部作品' />
        </Rise>
        <div className={`mt-10 divide-y border-y ${RECAP_RULE}`}>
          <WorkRow
            d={3}
            work={work}
            label={showFastest ? '追得最久' : `${date(work.completedAt)} 看完`}
            className={RECAP_RULE}
          >
            {date(work.firstWatchedAt)} 开始，
            {work.days === 1 ? '当天看完' : `前后 ${work.days} 天`}
          </WorkRow>
          {showFastest && (
            <WorkRow
              d={4}
              work={fastest}
              label='看得最快'
              className={RECAP_RULE}
            >
              {fastest.days === 1 ? '当天就看完了' : `${fastest.days} 天看完`}
            </WorkRow>
          )}
        </div>
      </SlideBody>
    </>
  );
}

export function ListsSlide({ report, audience }: SlideProps) {
  const { createdCount, itemCount, featured } = report.lists!;
  return (
    <>
      <RecapBackdrop tint='mist' />
      <SlideBody center>
        <Kicker>Lists</Kicker>
        {createdCount > 0 ? (
          <>
            <Lead d={1} className='mt-6'>
              这一年，{audience.you}新建了
            </Lead>
            <Rise d={2} className='mt-3'>
              <Figure value={createdCount} unit='个片单' />
            </Rise>
            {itemCount > 0 && (
              <Lead d={3} className='mt-4 tabular-nums'>
                往片单里收进了 {itemCount} 部作品
              </Lead>
            )}
          </>
        ) : (
          <>
            <Lead d={1} className='mt-6'>
              这一年，{audience.you}往片单里收进了
            </Lead>
            <Rise d={2} className='mt-3'>
              <Figure value={itemCount} unit='部作品' />
            </Rise>
          </>
        )}
        {featured && (
          <Rise d={4} className={`mt-10 border-y ${RECAP_RULE}`}>
            <Link
              href={listUrl(featured.id)}
              className='group flex items-center gap-5 py-5'
            >
              <div className='flex w-[88px] shrink-0'>
                {featured.covers.slice(0, 3).map((cover, index) => (
                  <RecapCover
                    key={index}
                    cover={cover}
                    title={featured.name}
                    className={`w-12 rounded-md ring-2 ring-gray-50 dark:ring-gray-950 ${STACK[index]}`}
                    sizes='56px'
                  />
                ))}
              </div>
              <div className='min-w-0'>
                <div className={`text-xs ${RECAP_TEXT.muted}`}>
                  {featured.likes > 0 ? '最受欢迎的片单' : '收得最满的片单'}
                </div>
                <div className='mt-1 truncate text-[17px] font-medium leading-snug group-hover:underline'>
                  {featured.name}
                </div>
                {featured.likes > 0 ? (
                  <div
                    className={`mt-1.5 flex items-center gap-1.5 text-[13px] tabular-nums ${RECAP_TEXT.accent}`}
                  >
                    <Heart className='h-3.5 w-3.5 fill-current' />
                    今年收获 {featured.likes} 个赞
                    <span className={RECAP_TEXT.muted}>
                      · {featured.itemCount} 部作品
                    </span>
                  </div>
                ) : (
                  <div
                    className={`mt-1.5 text-[13px] tabular-nums ${RECAP_TEXT.secondary}`}
                  >
                    {featured.itemCount} 部作品
                  </div>
                )}
              </div>
            </Link>
          </Rise>
        )}
      </SlideBody>
    </>
  );
}

// 观后信只在本人报告中出现
export function LettersSlide({ report }: SlideProps) {
  const { written, delivered, nextDeliverAt, biggestChange } = report.capsules!;
  const date = (at: number) =>
    formatInstantDate(at, report.timeZone, report.year);
  const progress = [
    delivered > 0 && written > 0 && `已有 ${delivered} 封送达`,
    nextDeliverAt !== null && `下一封将在 ${date(nextDeliverAt)} 送达`,
  ].filter(Boolean);
  return (
    <>
      <RecapBackdrop tint='dusk' at='top-left' />
      <SlideBody center>
        <Kicker>Letters</Kicker>
        <Lead d={1} className='mt-6'>
          {written > 0 ? '这一年，你写给未来的自己' : '这一年，过去的你寄来了'}
        </Lead>
        <Rise d={2} className='mt-3'>
          <Figure value={written > 0 ? written : delivered} unit='封信' />
        </Rise>
        {progress.length > 0 && (
          <Lead d={3} className='mt-4 tabular-nums'>
            {progress.join('，')}
          </Lead>
        )}
        {biggestChange && (
          <div className={`mt-10 border-y ${RECAP_RULE}`}>
            <WorkRow d={4} work={biggestChange} label='评分变化最大'>
              <span
                className={`inline-flex items-center gap-1.5 tabular-nums ${RECAP_TEXT.accent}`}
              >
                <Star className='h-3.5 w-3.5 fill-current' />
                {biggestChange.ratingThen.toFixed(1)}
                <span className={RECAP_TEXT.muted}>→</span>
                {biggestChange.ratingNow.toFixed(1)}
              </span>
            </WorkRow>
          </div>
        )}
      </SlideBody>
    </>
  );
}
