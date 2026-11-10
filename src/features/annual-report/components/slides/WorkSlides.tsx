'use client';

import { Star } from 'lucide-react';
import type { CSSProperties } from 'react';

import {
  Figure,
  Headline,
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
import {
  formatDuration,
  formatDurationShort,
  formatInstantDate,
  share,
} from '@/features/annual-report/lib/format';

const COVER_SHADOW = 'shadow-[0_24px_48px_-24px_rgba(15,23,42,0.5)]';

export function TopWorkSlide({ report }: SlideProps) {
  const work = report.topWorks[0];
  return (
    <>
      <RecapBackdrop tint='ice' />
      <SlideBody center className='items-center text-center'>
        <Kicker>Most Watched</Kicker>
        <Rise d={1} className='mt-9 w-[176px]'>
          <RecapCover
            cover={work.cover}
            title={work.title}
            className={`rounded-xl ${COVER_SHADOW}`}
            sizes='200px'
            priority
          />
        </Rise>
        <Lead d={2} className='mt-8'>
          你的年度最爱
        </Lead>
        <Rise
          d={2}
          as='h2'
          className='mt-1.5 line-clamp-2 text-[26px] font-medium leading-snug tracking-tight'
        >
          {work.title}
        </Rise>
        <Lead d={3} className='mt-3 tabular-nums'>
          看了 {formatDuration(work.watchSeconds)}
          {work.episodeCount > 1 && ` · ${work.episodeCount} 集`}
        </Lead>
        <Rise d={4} className={`mt-1 text-[13px] ${RECAP_TEXT.muted}`}>
          {formatInstantDate(work.firstWatchedAt, report.timeZone)} 初次相遇
        </Rise>
      </SlideBody>
    </>
  );
}

const RANKING_LIMIT = 5;

export function RankingSlide({ report }: SlideProps) {
  const works = report.topWorks.slice(0, RANKING_LIMIT);
  const max = works[0]?.watchSeconds || 1;
  return (
    <>
      <RecapBackdrop tint='mist' at='top-left' />
      <SlideBody center>
        <Kicker>Top {works.length}</Kicker>
        <Headline d={1} className='mt-6'>
          这些作品，占据了你最多的时间
        </Headline>
        <ol className='mt-8'>
          {works.map((work, index) => (
            <Rise
              as='li'
              key={`${work.title}-${index}`}
              d={2 + index * 0.8}
              className={`flex items-center gap-4 py-3 ${index > 0 ? `border-t ${RECAP_RULE}` : ''}`}
            >
              <span
                className={`w-5 shrink-0 text-lg font-extralight tabular-nums ${index === 0 ? RECAP_TEXT.accent : RECAP_TEXT.muted}`}
              >
                {index + 1}
              </span>
              <RecapCover
                cover={work.cover}
                title={work.title}
                className='w-10 rounded'
                sizes='40px'
              />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-[15px]'>{work.title}</div>
                <div className='mt-2 flex items-center gap-3'>
                  <div className='h-[3px] flex-1 overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]'>
                    <div
                      className={`recap-grow-x h-full rounded-full ${index === 0 ? 'bg-brand-500 dark:bg-brand-300' : 'bg-gray-400 dark:bg-gray-500'}`}
                      style={
                        {
                          '--d': 2 + index,
                          width: `${Math.max(4, (work.watchSeconds / max) * 100)}%`,
                        } as CSSProperties
                      }
                    />
                  </div>
                  <span
                    className={`w-[72px] shrink-0 whitespace-nowrap text-right text-xs tabular-nums ${RECAP_TEXT.secondary}`}
                  >
                    {formatDurationShort(work.watchSeconds)}
                  </span>
                </div>
              </div>
            </Rise>
          ))}
        </ol>
        {report.totals.workCount > works.length && (
          <Rise
            d={7}
            className={`mt-4 border-t pt-5 text-[13px] ${RECAP_RULE} ${RECAP_TEXT.muted}`}
          >
            全年共看过 {report.totals.workCount} 部作品
          </Rise>
        )}
      </SlideBody>
    </>
  );
}

export function JourneySlide({ report }: SlideProps) {
  const first = report.firstWork!;
  const last = report.lastWork!;
  const moments = [
    {
      work: first,
      date: formatInstantDate(first.at, report.timeZone),
      label: `你用这部作品开启了 ${report.year}`,
    },
    {
      work: last,
      date: formatInstantDate(last.at, report.timeZone),
      label: report.inProgress ? '你最近在看' : '你用它为这一年收尾',
    },
  ];
  return (
    <>
      <RecapBackdrop tint='dusk' />
      <SlideBody center>
        <Kicker>First &amp; Latest</Kicker>
        <Headline d={1} className='mt-6'>
          从第一部到{report.inProgress ? '现在' : '最后一部'}
        </Headline>
        <div className='relative mt-10'>
          <div
            className='recap-grow-y absolute bottom-12 left-[3.5px] top-12 w-px bg-gray-900/15 dark:bg-white/15'
            style={{ '--d': 6, transformOrigin: 'top' } as CSSProperties}
          />
          {moments.map(({ work, date, label }, index) => (
            <Rise
              key={index}
              d={2 + index * 2}
              className={`relative flex items-center gap-5 pl-6 ${index > 0 ? 'mt-12' : ''}`}
            >
              <span
                aria-hidden
                className={`absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${index === 0 ? 'bg-gray-400 dark:bg-gray-500' : 'bg-brand-500 dark:bg-brand-300'}`}
              />
              <RecapCover
                cover={work.cover}
                title={work.title}
                className={`w-[76px] rounded-md ${COVER_SHADOW}`}
                sizes='96px'
              />
              <div className='min-w-0'>
                <div className={`text-xs tabular-nums ${RECAP_TEXT.muted}`}>
                  {date}
                </div>
                <div className={`mt-1 text-[13px] ${RECAP_TEXT.secondary}`}>
                  {label}
                </div>
                <div className='mt-2 line-clamp-2 text-lg font-medium leading-snug'>
                  {work.title}
                </div>
              </div>
            </Rise>
          ))}
        </div>
      </SlideBody>
    </>
  );
}

export function SourcesSlide({ report }: SlideProps) {
  const sources = report.topSources;
  const top = sources[0];
  return (
    <>
      <RecapBackdrop tint='frost' at='top-left' />
      <SlideBody center>
        <Kicker>Sources</Kicker>
        <Headline d={1} className='mt-6'>
          {top.sourceName} 是你最常用的片源
        </Headline>
        <Lead d={2} className='mt-2'>
          占全年观看的 {share(top.watchSeconds, report.totals.watchSeconds)}%
        </Lead>
        <div className='mt-10 space-y-5'>
          {sources.map((source, index) => (
            <Rise key={source.source} d={3 + index * 0.8}>
              <div className='flex items-baseline justify-between gap-4 text-[15px]'>
                <span className='truncate'>{source.sourceName}</span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${RECAP_TEXT.secondary}`}
                >
                  {source.workCount} 部 ·{' '}
                  {formatDurationShort(source.watchSeconds)}
                </span>
              </div>
              <div className='mt-2 h-[3px] overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]'>
                <div
                  className={`recap-grow-x h-full rounded-full ${index === 0 ? 'bg-brand-500 dark:bg-brand-300' : 'bg-gray-400 dark:bg-gray-500'}`}
                  style={
                    {
                      '--d': 3 + index,
                      width: `${Math.max(3, share(source.watchSeconds, top.watchSeconds))}%`,
                    } as CSSProperties
                  }
                />
              </div>
            </Rise>
          ))}
        </div>
        {report.totals.sourceCount > sources.length && (
          <Rise
            d={8}
            className={`mt-8 border-t pt-5 text-[13px] ${RECAP_RULE} ${RECAP_TEXT.muted}`}
          >
            这一年你一共用过 {report.totals.sourceCount} 个片源
          </Rise>
        )}
      </SlideBody>
    </>
  );
}

export function ReviewsSlide({ report }: SlideProps) {
  const { reviews } = report;
  const multiple = reviews.ratedCount > 1;
  return (
    <>
      <RecapBackdrop tint='sand' at='top-left' />
      <SlideBody center>
        <Kicker>Reviews</Kicker>
        <Lead d={1} className='mt-6'>
          这一年，你写下了
        </Lead>
        <Rise d={2} className='mt-3'>
          <Figure value={reviews.count} unit='条评价' />
        </Rise>
        {multiple && reviews.averageRating !== null && (
          <Lead d={3} className='mt-4'>
            平均给出 {reviews.averageRating.toFixed(1)} 分
          </Lead>
        )}
        {reviews.topRated && (
          <Rise
            d={4}
            className={`mt-10 flex items-center gap-5 border-y py-5 ${RECAP_RULE}`}
          >
            <RecapCover
              cover={reviews.topRated.cover}
              title={reviews.topRated.title}
              className={`w-16 rounded-md ${COVER_SHADOW}`}
              sizes='80px'
            />
            <div className='min-w-0'>
              <div className={`text-xs ${RECAP_TEXT.muted}`}>
                {multiple ? '全年最高分' : '你的评分'}
              </div>
              <div className='mt-1 line-clamp-2 text-[17px] font-medium leading-snug'>
                {reviews.topRated.title}
              </div>
              <div
                className={`mt-2 flex items-center gap-1.5 ${RECAP_TEXT.accent}`}
              >
                <Star className='h-4 w-4 fill-current' />
                <span className='text-lg font-light tabular-nums'>
                  {reviews.topRated.rating.toFixed(1)}
                </span>
              </div>
            </div>
          </Rise>
        )}
      </SlideBody>
    </>
  );
}
