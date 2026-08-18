'use client';

import { Cat, ChevronRight, Clover, Film, Tv } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import ContinueWatching from '@/components/ContinueWatching';
import HomePosterCardSkeleton, {
  HOME_POSTER_CARD_CLASS,
} from '@/components/HomePosterCardSkeleton';
import AnnouncementModal from '@/components/modals/AnnouncementModal';
import PageLayout from '@/components/PageLayout';
import PosterCard from '@/components/PosterCard';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import { GetBangumiCalendarData } from '@/features/bangumi/lib/bangumi.client';
import { selectBangumiCardCover } from '@/features/bangumi/lib/bangumi-normalize';
import {
  getCurrentWeekday,
  primeDefaultDoubanFeedViewCache,
} from '@/features/douban/hooks/useDoubanFeed';
import { HomeInitialData } from '@/features/home/lib/home.types';
import { getDoubanCategories } from '@/lib/douban.client';
import {
  readSeenAnnouncement,
  writeSeenAnnouncement,
} from '@/lib/local-preferences';
import { DoubanItem } from '@/lib/types';

import {
  mergeHomeInitialDataWithClientSnapshot,
  writeHomeClientSnapshot,
} from '../lib/home-client-cache';
import { HomeMineSwitch } from './HomeMineSwitch';

interface HomeClientProps {
  initialData: HomeInitialData;
  continueWatchingSkeletonCount?: number;
  routeFallback?: boolean;
}

type RecommendationLoadingState = {
  hotMovies: boolean;
  hotTvShows: boolean;
  hotVarietyShows: boolean;
  bangumiCalendar: boolean;
};

const RECOMMENDATION_UNAVAILABLE_MESSAGE = '暂时无法获取数据';

function RecommendationSkeletonRow() {
  return Array.from({ length: 8 }).map((_, index) => (
    <HomePosterCardSkeleton key={index} />
  ));
}

function RecommendationEmptyRow({ message }: { message: string }) {
  return (
    <div className='flex min-h-[172px] min-w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400 sm:min-h-[298px]'>
      {message}
    </div>
  );
}

function RecommendationSection({
  title,
  href,
  icon: Icon,
  iconClassName,
  items,
  loading,
  type,
  isBangumi = false,
  priorityCount = 0,
  emptyMessage,
}: {
  title: string;
  href: string;
  icon: typeof Film;
  iconClassName: string;
  items: DoubanItem[];
  loading: boolean;
  type?: string;
  isBangumi?: boolean;
  priorityCount?: number;
  emptyMessage?: string;
}) {
  return (
    <section className='mb-2'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-200 sm:text-xl'>
          <Icon className={iconClassName} />
          {title}
        </h2>
        <Link
          href={href}
          className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>
      <ScrollableRow initialItemCount={8} mountBatchSize={8}>
        {loading ? (
          RecommendationSkeletonRow()
        ) : items.length > 0 ? (
          items.map((item, index) => (
            <div key={item.id} className={HOME_POSTER_CARD_CLASS}>
              <PosterCard
                title={item.title}
                poster={item.poster}
                doubanId={Number(item.id)}
                rate={item.rate}
                year={item.year}
                type={type}
                isBangumi={isBangumi}
                priority={index < priorityCount}
              />
            </div>
          ))
        ) : emptyMessage ? (
          <RecommendationEmptyRow message={emptyMessage} />
        ) : null}
      </ScrollableRow>
    </section>
  );
}

function hasUsableBangumiCalendarData(
  data: HomeInitialData['bangumiCalendarData'],
): boolean {
  return data.some((item) => item.items.length > 0);
}

export default function HomeClient({
  initialData,
  continueWatchingSkeletonCount = 0,
  routeFallback = false,
}: HomeClientProps) {
  const [initialViewData] = useState(() =>
    mergeHomeInitialDataWithClientSnapshot(initialData),
  );
  const [hotMovies, setHotMovies] = useState(initialViewData.hotMovies);
  const [hotTvShows, setHotTvShows] = useState(initialViewData.hotTvShows);
  const [hotVarietyShows, setHotVarietyShows] = useState(
    initialViewData.hotVarietyShows,
  );
  const [bangumiCalendarData, setBangumiCalendarData] = useState(
    initialViewData.bangumiCalendarData,
  );
  const [unavailable, setUnavailable] = useState<RecommendationLoadingState>({
    hotMovies: false,
    hotTvShows: false,
    hotVarietyShows: false,
    bangumiCalendar: false,
  });
  const [loading, setLoading] = useState<RecommendationLoadingState>(() => ({
    hotMovies: initialData.hotMovies.length === 0,
    hotTvShows: initialData.hotTvShows.length === 0,
    hotVarietyShows: initialData.hotVarietyShows.length === 0,
    bangumiCalendar: initialData.bangumiCalendarData.length === 0,
  }));
  const { announcement } = useSite();

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = readSeenAnnouncement();
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  useEffect(() => {
    const shouldLoadHotMovies = initialData.hotMovies.length === 0;
    const shouldLoadHotTvShows = initialData.hotTvShows.length === 0;
    const shouldLoadHotVarietyShows = initialData.hotVarietyShows.length === 0;
    const shouldLoadBangumi = initialData.bangumiCalendarData.length === 0;

    let cancelled = false;

    const finishLoading = (key: keyof RecommendationLoadingState) => {
      if (!cancelled) {
        setLoading((prev) => ({ ...prev, [key]: false }));
      }
    };
    const setSectionUnavailable = (
      key: keyof RecommendationLoadingState,
      value: boolean,
    ) => {
      if (!cancelled) {
        setUnavailable((prev) => ({ ...prev, [key]: value }));
      }
    };

    const loadHotMovies = async () => {
      if (!shouldLoadHotMovies) {
        return;
      }

      try {
        const moviesData = await getDoubanCategories({
          kind: 'movie',
          category: '热门',
          type: '全部',
        });

        if (!cancelled && moviesData.code === 200 && moviesData.list.length) {
          setHotMovies(moviesData.list);
          setSectionUnavailable('hotMovies', false);
        } else {
          setSectionUnavailable('hotMovies', true);
        }
      } catch (error) {
        console.error('获取热门电影失败:', error);
        setSectionUnavailable('hotMovies', true);
      } finally {
        finishLoading('hotMovies');
      }
    };

    const loadHotTvShows = async () => {
      if (!shouldLoadHotTvShows) {
        return;
      }

      try {
        const tvShowsData = await getDoubanCategories({
          kind: 'tv',
          category: 'tv',
          type: 'tv',
        });

        if (!cancelled && tvShowsData.code === 200 && tvShowsData.list.length) {
          setHotTvShows(tvShowsData.list);
          setSectionUnavailable('hotTvShows', false);
        } else {
          setSectionUnavailable('hotTvShows', true);
        }
      } catch (error) {
        console.error('获取热门剧集失败:', error);
        setSectionUnavailable('hotTvShows', true);
      } finally {
        finishLoading('hotTvShows');
      }
    };

    const loadHotVarietyShows = async () => {
      if (!shouldLoadHotVarietyShows) {
        return;
      }

      try {
        const varietyShowsData = await getDoubanCategories({
          kind: 'tv',
          category: 'show',
          type: 'show',
        });

        if (
          !cancelled &&
          varietyShowsData.code === 200 &&
          varietyShowsData.list.length
        ) {
          setHotVarietyShows(varietyShowsData.list);
          setSectionUnavailable('hotVarietyShows', false);
        } else {
          setSectionUnavailable('hotVarietyShows', true);
        }
      } catch (error) {
        console.error('获取热门综艺失败:', error);
        setSectionUnavailable('hotVarietyShows', true);
      } finally {
        finishLoading('hotVarietyShows');
      }
    };

    const loadBangumi = async () => {
      if (!shouldLoadBangumi) {
        return;
      }

      try {
        const bangumiData = await GetBangumiCalendarData();

        if (!cancelled && hasUsableBangumiCalendarData(bangumiData)) {
          setBangumiCalendarData(bangumiData);
          setSectionUnavailable('bangumiCalendar', false);
          finishLoading('bangumiCalendar');
        } else if (!cancelled) {
          setSectionUnavailable('bangumiCalendar', true);
          finishLoading('bangumiCalendar');
        }
      } catch (error) {
        console.error('获取新番放送失败:', error);
        if (!cancelled) {
          setSectionUnavailable('bangumiCalendar', true);
          finishLoading('bangumiCalendar');
        }
      }
    };

    void loadHotMovies();
    void loadHotTvShows();
    void loadHotVarietyShows();
    void loadBangumi();

    return () => {
      cancelled = true;
    };
  }, [
    initialData.bangumiCalendarData.length,
    initialData.hotMovies.length,
    initialData.hotTvShows.length,
    initialData.hotVarietyShows.length,
  ]);

  const currentWeekday = useMemo(() => getCurrentWeekday(), []);

  const todayAnimes = useMemo(() => {
    const items =
      bangumiCalendarData.find((item) => item.weekday.en === currentWeekday)
        ?.items || [];

    return items.map((anime) => ({
      id: anime.id.toString(),
      title: anime.name_cn || anime.name,
      poster: selectBangumiCardCover(anime.images),
      rate: anime.rating?.score?.toFixed(1) || '',
      year: anime.air_date?.split('-')?.[0] || '',
    }));
  }, [bangumiCalendarData, currentWeekday]);

  useEffect(() => {
    primeDefaultDoubanFeedViewCache('movie', hotMovies);
    primeDefaultDoubanFeedViewCache('tv', hotTvShows);
    primeDefaultDoubanFeedViewCache('show', hotVarietyShows);
    primeDefaultDoubanFeedViewCache('anime', todayAnimes, {
      selectedWeekday: currentWeekday,
    });
  }, [currentWeekday, hotMovies, hotTvShows, hotVarietyShows, todayAnimes]);

  useEffect(() => {
    const completeRecommendationData =
      hotMovies.length > 0 &&
      hotTvShows.length > 0 &&
      hotVarietyShows.length > 0 &&
      hasUsableBangumiCalendarData(bangumiCalendarData);

    if (
      routeFallback ||
      !completeRecommendationData ||
      Object.values(unavailable).some(Boolean) ||
      Object.values(loading).some(Boolean)
    ) {
      return;
    }

    writeHomeClientSnapshot(
      {
        hotMovies,
        hotTvShows,
        hotVarietyShows,
        bangumiCalendarData,
      },
      continueWatchingSkeletonCount,
    );
  }, [
    bangumiCalendarData,
    continueWatchingSkeletonCount,
    hotMovies,
    hotTvShows,
    hotVarietyShows,
    loading,
    routeFallback,
    unavailable,
  ]);

  const handleCloseAnnouncement = (currentAnnouncement: string) => {
    setShowAnnouncement(false);
    writeSeenAnnouncement(currentAnnouncement);
  };

  return (
    <PageLayout>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 hidden justify-center md:flex'>
          <HomeMineSwitch active='home' />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div className='-mb-3 sm:-mb-6'>
            <ContinueWatching
              initialSkeletonCount={continueWatchingSkeletonCount}
              refreshOnMount={!routeFallback}
            />

            <RecommendationSection
              title='热门电影'
              href='/douban?type=movie'
              icon={Film}
              iconClassName='h-5 w-5 text-blue-500'
              items={hotMovies}
              loading={loading.hotMovies && hotMovies.length === 0}
              type='movie'
              priorityCount={4}
              emptyMessage={
                unavailable.hotMovies
                  ? RECOMMENDATION_UNAVAILABLE_MESSAGE
                  : undefined
              }
            />

            <RecommendationSection
              title='热门剧集'
              href='/douban?type=tv'
              icon={Tv}
              iconClassName='h-5 w-5 text-emerald-500'
              items={hotTvShows}
              loading={loading.hotTvShows && hotTvShows.length === 0}
              emptyMessage={
                unavailable.hotTvShows
                  ? RECOMMENDATION_UNAVAILABLE_MESSAGE
                  : undefined
              }
            />

            <RecommendationSection
              title='新番放送'
              href='/douban?type=anime'
              icon={Cat}
              iconClassName='h-5 w-5 text-pink-500'
              items={todayAnimes}
              loading={
                loading.bangumiCalendar &&
                todayAnimes.length === 0 &&
                !unavailable.bangumiCalendar
              }
              isBangumi={true}
              emptyMessage={
                unavailable.bangumiCalendar
                  ? RECOMMENDATION_UNAVAILABLE_MESSAGE
                  : undefined
              }
            />

            <RecommendationSection
              title='热门综艺'
              href='/douban?type=show'
              icon={Clover}
              iconClassName='h-5 w-5 text-violet-500'
              items={hotVarietyShows}
              loading={loading.hotVarietyShows && hotVarietyShows.length === 0}
              emptyMessage={
                unavailable.hotVarietyShows
                  ? RECOMMENDATION_UNAVAILABLE_MESSAGE
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {announcement && (
        <AnnouncementModal
          isOpen={showAnnouncement}
          message={announcement}
          onClose={() => handleCloseAnnouncement(announcement)}
        />
      )}
    </PageLayout>
  );
}
