'use client';

import { ExternalLink, Play, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import {
  buildExternalSubjectUrl,
  hasDisplayableRate,
  usePosterPlay,
} from '@/hooks/usePosterPlay';

import type { HomeHeroItem } from '../lib/home-hero';

const ROTATE_INTERVAL_MS = 8000;

function heroMetaParts(item: HomeHeroItem): string[] {
  return [
    item.year,
    item.region,
    item.genres?.slice(0, 3).join(' / '),
    item.episodesInfo,
  ].filter((part): part is string => Boolean(part));
}

function heroCredits(item: HomeHeroItem): string {
  return [
    item.directors && `导演 ${item.directors}`,
    item.actors && `主演 ${item.actors}`,
  ]
    .filter(Boolean)
    .join('　');
}

function HeroRate({ rate, className }: { rate: string; className: string }) {
  if (!hasDisplayableRate(rate)) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tabular-nums text-amber-500 dark:text-amber-300 ${className}`}
    >
      <Star className='h-[1em] w-[1em] fill-current' />
      {rate}
    </span>
  );
}

function HeroMetaLine({
  item,
  className,
}: {
  item: HomeHeroItem;
  className: string;
}) {
  const parts = heroMetaParts(item);
  return (
    <p className={`flex min-w-0 items-center gap-x-2 ${className}`}>
      <HeroRate rate={item.rate} className='shrink-0' />
      {parts.length > 0 && (
        <span className='truncate text-gray-600 dark:text-gray-300'>
          {parts.join(' · ')}
        </span>
      )}
    </p>
  );
}

function HeroActions({ item }: { item: HomeHeroItem }) {
  const { play, prefetch, cancelPrefetch } = usePosterPlay({
    title: item.title,
    year: item.year,
    type: item.type,
  });
  const externalUrl = buildExternalSubjectUrl(Number(item.id));

  return (
    <div className='mt-7 flex items-center gap-3'>
      <button
        type='button'
        onClick={play}
        onMouseEnter={prefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={prefetch}
        onBlur={cancelPrefetch}
        className='inline-flex h-11 items-center gap-2 rounded-full bg-brand-500 pl-5 pr-6 text-[15px] font-medium text-white shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-600'
      >
        <Play className='h-4 w-4 fill-current' />
        立即播放
      </button>
      {externalUrl && (
        <a
          href={externalUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex h-11 items-center gap-2 rounded-full bg-gray-900/[0.06] px-5 text-[15px] text-gray-700 transition-colors hover:bg-gray-900/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15'
        >
          豆瓣
          <ExternalLink className='h-3.5 w-3.5' />
        </a>
      )}
    </div>
  );
}

function DesktopHero({ items }: { items: HomeHeroItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;

  useEffect(() => {
    if (paused || count < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setActiveIndex((index) => (index + 1) % count);
      }
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  const current = items[Math.min(activeIndex, count - 1)];
  const credits = heroCredits(current);

  return (
    <section
      aria-roledescription='carousel'
      aria-label='精选'
      className='relative -mt-16 hidden overflow-hidden md:block'
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className='absolute inset-0' aria-hidden='true'>
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`absolute inset-0 scale-125 blur-3xl transition-opacity duration-1000 ${
              index === activeIndex ? 'opacity-60 dark:opacity-45' : 'opacity-0'
            }`}
          >
            <CoverImage src={item.poster} alt='' sizes='128px' />
          </div>
        ))}
        <div className='absolute inset-0 bg-gradient-to-r from-gray-50/90 via-gray-50/60 to-gray-50/10 dark:from-gray-950/90 dark:via-gray-950/60 dark:to-gray-950/10' />
        <div className='absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-gray-50 to-transparent dark:from-gray-950' />
      </div>

      <div
        className={`${PAGE_CONTAINER_CLASS} relative flex h-[clamp(440px,58vh,560px)] items-end gap-10 pb-10 pt-24`}
      >
        <div
          key={current.id}
          className='relative aspect-[2/3] w-48 shrink-0 animate-fade-in overflow-hidden rounded-xl shadow-2xl shadow-black/30 ring-1 ring-black/5 dark:ring-white/10 lg:w-56'
        >
          <CoverImage
            src={current.poster}
            alt={current.title}
            sizes='(min-width: 1024px) 224px, 192px'
            priority
          />
        </div>

        <div
          key={`${current.id}-info`}
          className='min-w-0 max-w-2xl flex-1 animate-slide-up pb-1'
        >
          <p className='text-xs font-medium tracking-wider text-brand-600 dark:text-brand-300'>
            {current.label}
          </p>
          <h2 className='mt-2 line-clamp-2 text-4xl font-bold tracking-tight text-gray-900 dark:text-white lg:text-5xl lg:leading-tight'>
            {current.title}
          </h2>
          <HeroMetaLine item={current} className='mt-3 text-[15px]' />
          {current.intro && (
            <p className='mt-4 line-clamp-3 text-[15px] leading-7 text-gray-700 dark:text-gray-300'>
              {current.intro}
            </p>
          )}
          {credits && (
            <p className='mt-3 truncate text-sm text-gray-500 dark:text-gray-400'>
              {credits}
            </p>
          )}
          <HeroActions item={current} />
        </div>

        {count > 1 && (
          <div
            className='ml-auto hidden shrink-0 items-end gap-2 self-end lg:flex'
            role='tablist'
            aria-label='切换精选'
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type='button'
                role='tab'
                aria-selected={index === activeIndex}
                aria-label={item.title}
                onClick={() => setActiveIndex(index)}
                className={`relative aspect-[2/3] overflow-hidden rounded-md transition-all duration-300 ${
                  index === activeIndex
                    ? 'w-14 opacity-100 ring-2 ring-brand-400 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-950'
                    : 'w-11 opacity-50 hover:opacity-90'
                }`}
              >
                <CoverImage src={item.poster} alt='' sizes='64px' />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MobileHeroCard({ item }: { item: HomeHeroItem }) {
  const { play } = usePosterPlay({
    title: item.title,
    year: item.year,
    type: item.type,
  });

  return (
    <button
      type='button'
      onClick={play}
      aria-label={`播放 ${item.title}`}
      className='relative w-[88%] shrink-0 snap-center overflow-hidden rounded-2xl bg-white text-left ring-1 ring-gray-900/[0.06] active:scale-[0.99] dark:bg-gray-900 dark:ring-white/[0.06]'
    >
      <div
        className='absolute inset-0 scale-150 opacity-30 blur-2xl dark:opacity-40'
        aria-hidden='true'
      >
        <CoverImage src={item.poster} alt='' sizes='128px' />
      </div>
      <div className='relative flex h-full gap-4 p-3'>
        <div className='relative aspect-[2/3] w-[6.5rem] shrink-0 overflow-hidden rounded-lg shadow-lg shadow-black/20'>
          <CoverImage src={item.poster} alt={item.title} sizes='104px' />
        </div>
        <div className='flex min-w-0 flex-1 flex-col py-1'>
          <p className='text-[11px] font-medium text-brand-600 dark:text-brand-300'>
            {item.label}
          </p>
          <h2 className='mt-1 line-clamp-1 text-lg font-semibold text-gray-900 dark:text-white'>
            {item.title}
          </h2>
          <HeroMetaLine item={item} className='mt-1 text-xs' />
          {item.intro && (
            <p className='mt-2 line-clamp-3 text-[13px] leading-5 text-gray-600 dark:text-gray-300'>
              {item.intro}
            </p>
          )}
          <div className='mt-auto pt-3'>
            <span className='inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-500 pl-3 pr-3.5 text-[13px] font-medium text-white'>
              <Play className='h-3.5 w-3.5 fill-current' />
              播放
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function MobileHero({ items }: { items: HomeHeroItem[] }) {
  return (
    <section aria-label='精选' className='pt-3 md:hidden'>
      <div className='scrollbar-hide flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4'>
        {items.map((item) => (
          <MobileHeroCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function HomeHero({ items }: { items: HomeHeroItem[] }) {
  if (items.length === 0) return null;

  return (
    <>
      <DesktopHero items={items} />
      <MobileHero items={items} />
    </>
  );
}

export function HomeHeroSkeleton() {
  return (
    <>
      <section aria-hidden='true' className='relative -mt-16 hidden md:block'>
        <div
          className={`${PAGE_CONTAINER_CLASS} flex h-[clamp(440px,58vh,560px)] items-end gap-10 pb-10 pt-24`}
        >
          <div className='aspect-[2/3] w-48 shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800 lg:w-56' />
          <div className='w-full max-w-2xl flex-1 pb-1'>
            <div className='h-3 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='mt-3 h-11 w-2/3 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800 lg:h-14' />
            <div className='mt-4 h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='mt-5 space-y-2.5'>
              <div className='h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='h-4 w-11/12 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              <div className='h-4 w-3/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            </div>
            <div className='mt-8 flex gap-3'>
              <div className='h-11 w-32 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800' />
              <div className='h-11 w-24 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800' />
            </div>
          </div>
        </div>
      </section>
      <section aria-hidden='true' className='overflow-hidden pt-3 md:hidden'>
        <div className='flex gap-3 px-4'>
          {[0, 1].map((index) => (
            <div
              key={index}
              className='flex w-[88%] shrink-0 gap-4 rounded-2xl bg-white p-3 ring-1 ring-gray-900/[0.06] dark:bg-gray-900 dark:ring-white/[0.06]'
            >
              <div className='aspect-[2/3] w-[6.5rem] shrink-0 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800' />
              <div className='flex-1 space-y-2 py-1'>
                <div className='h-3 w-8 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
                <div className='h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
                <div className='h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
                <div className='h-3 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
                <div className='h-3 w-5/6 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
