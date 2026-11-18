'use client';

import { Star, Users } from 'lucide-react';
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
} from '@/features/annual-report/lib/format';

const COVER_SHADOW = 'shadow-[0_24px_48px_-24px_rgba(15,23,42,0.5)]';

export function TopWorkSlide({ report, audience }: SlideProps) {
  const work = report.topWorks[0];
  const watchers = report.social?.topWorkWatchers ?? 0;
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
          {audience.you}的年度最爱
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
        {watchers > 0 && (
          <Rise
            d={5}
            className={`mt-6 inline-flex items-center gap-1.5 text-[13px] ${RECAP_TEXT.secondary}`}
          >
            <Users className='h-3.5 w-3.5' strokeWidth={1.75} />
            关注的人里有 {watchers} 位也看过
          </Rise>
        )}
      </SlideBody>
    </>
  );
}

const RANKING_LIMIT = 5;

// 第 1 名由年度作品页展示，这里从第 2 名列起，进度条仍以第 1 名为满格
export function RankingSlide({ report, audience }: SlideProps) {
  const ranked = report.topWorks.slice(0, RANKING_LIMIT);
  const works = ranked.slice(1);
  const max = ranked[0]?.watchSeconds || 1;
  return (
    <>
      <RecapBackdrop tint='mist' at='top-left' />
      <SlideBody center>
        <Kicker>Top {ranked.length}</Kicker>
        <Headline d={1} className='mt-6'>
          紧随年度最爱之后，{audience.you}还常看这些
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
                className={`w-5 shrink-0 text-lg font-extralight tabular-nums ${RECAP_TEXT.muted}`}
              >
                {index + 2}
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
                      className='recap-grow-x h-full rounded-full bg-gray-400 dark:bg-gray-500'
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
        {report.totals.workCount > ranked.length && (
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

export function JourneySlide({ report, audience }: SlideProps) {
  const first = report.firstWork!;
  const last = report.lastWork!;
  const moments = [
    {
      work: first,
      date: formatInstantDate(first.at, report.timeZone),
      label: `${audience.you}用这部作品开启了 ${report.year}`,
    },
    {
      work: last,
      date: formatInstantDate(last.at, report.timeZone),
      label: report.inProgress
        ? `${audience.you}最近在看`
        : `${audience.you}用它为这一年收尾`,
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

export function ReviewsSlide({ report, audience }: SlideProps) {
  const { reviews } = report;
  const multiple = reviews.ratedCount > 1;
  const newFollowing = report.social?.newFollowing ?? 0;
  return (
    <>
      <RecapBackdrop tint='sand' at='top-left' />
      <SlideBody center>
        <Kicker>Reviews</Kicker>
        <Lead d={1} className='mt-6'>
          这一年，{audience.you}写下了
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
                {multiple ? '全年最高分' : `${audience.you}的评分`}
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
        {newFollowing > 0 && (
          <Rise d={5} className={`mt-6 text-[13px] ${RECAP_TEXT.muted}`}>
            这一年{audience.you}还新关注了 {newFollowing} 位同好
          </Rise>
        )}
      </SlideBody>
    </>
  );
}
