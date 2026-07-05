'use client';

import {
  Cat,
  ChevronRight,
  Clover,
  Film,
  Home as HomeIcon,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { GetBangumiCalendarData } from '@/features/bangumi/lib/bangumi.client';
import { selectBangumiCardCover } from '@/features/bangumi/lib/bangumi-normalize';
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { HomeInitialData } from '@/features/home/lib/home.types';
import {
  readSeenAnnouncement,
  writeSeenAnnouncement,
} from '@/lib/local-preferences';
import { DoubanItem } from '@/lib/types';
import {
  getCurrentWeekday,
  primeDefaultDoubanFeedViewCache,
} from '@/features/douban/hooks/useDoubanFeed';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import HomePosterCardSkeleton, {
  HOME_POSTER_CARD_CLASS,
} from '@/components/HomePosterCardSkeleton';
import ConfirmModal from '@/components/modals/ConfirmModal';
import AnnouncementModal from '@/components/modals/AnnouncementModal';
import PageLayout from '@/components/PageLayout';
import PosterCard from '@/components/PosterCard';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

interface HomeClientProps {
  initialData: HomeInitialData;
  continueWatchingSkeletonCount?: number;
}

type FavoriteItem = {
  id: string;
  source: string;
  title: string;
  year?: string;
  poster: string;
  episodes: number;
  source_name: string;
  currentEpisode?: number;
  progress?: number;
  search_title?: string;
  origin?: 'vod' | 'live';
};

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
    <section className='mb-4'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
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
      <ScrollableRow>
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
}: HomeClientProps) {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  // 滑入方向：切到收藏时从右侧进入，切回首页时从左侧进入
  const [slideKey, setSlideKey] = useState(0);
  const [slideFrom, setSlideFrom] = useState<'left' | 'right' | null>(null);
  const handleTabChange = (value: string) => {
    const newTab = value as 'home' | 'favorites';
    if (newTab === activeTab) return;
    setSlideFrom(newTab === 'favorites' ? 'right' : 'left');
    setSlideKey((k) => k + 1);
    setActiveTab(newTab);
  };
  const [hotMovies, setHotMovies] = useState(initialData.hotMovies);
  const [hotTvShows, setHotTvShows] = useState(initialData.hotTvShows);
  const [hotVarietyShows, setHotVarietyShows] = useState(
    initialData.hotVarietyShows,
  );
  const [bangumiCalendarData, setBangumiCalendarData] = useState(
    initialData.bangumiCalendarData,
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
  const [showClearFavConfirm, setShowClearFavConfirm] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

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
  }, []);

  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);
        const playRecord = allPlayRecords[key];

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode: playRecord?.index,
          progress:
            playRecord?.total_time > 0
              ? (playRecord.play_time / playRecord.total_time) * 100
              : 0,
          search_title: fav?.search_title,
          origin: fav?.origin,
        } as FavoriteItem;
      });

    setFavoriteItems(sorted);
  };

  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      },
    );

    return unsubscribe;
  }, [activeTab]);

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

  const handleCloseAnnouncement = (currentAnnouncement: string) => {
    setShowAnnouncement(false);
    writeSeenAnnouncement(currentAnnouncement);
  };

  return (
    <PageLayout>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home', icon: HomeIcon },
              { label: '收藏', value: 'favorites', icon: Star },
            ]}
            active={activeTab}
            onChange={handleTabChange}
          />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div
            key={slideKey}
            className={
              slideFrom === 'right'
                ? 'animate-[slide-in-right_250ms_ease-out]'
                : slideFrom === 'left'
                  ? 'animate-[slide-in-left_250ms_ease-out]'
                  : ''
            }
          >
            {activeTab === 'favorites' ? (
              <section className='mb-4'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
                    <Star className='h-5 w-5 text-amber-500' />
                    我的收藏
                  </h2>
                  {favoriteItems.length > 0 && (
                    <button
                      className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      onClick={() => setShowClearFavConfirm(true)}
                    >
                      清空
                    </button>
                  )}
                </div>
                <div className='grid grid-cols-3 justify-start gap-x-2 gap-y-14 px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:gap-y-20 sm:px-2'>
                  {favoriteItems.map((item) => (
                    <div
                      key={item.id + item.source}
                      className='w-24 sm:w-[180px]'
                    >
                      <VideoCard
                        query={item.search_title}
                        {...item}
                        from='favorite'
                        type={item.episodes > 1 ? 'tv' : ''}
                      />
                    </div>
                  ))}
                  {favoriteItems.length === 0 && (
                    <div className='col-span-full py-8 text-center text-gray-500 dark:text-gray-400'>
                      暂无收藏内容
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <div className='-mb-8 sm:-mb-10'>
                <ContinueWatching
                  initialSkeletonCount={continueWatchingSkeletonCount}
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
                  loading={
                    loading.hotVarietyShows && hotVarietyShows.length === 0
                  }
                  emptyMessage={
                    unavailable.hotVarietyShows
                      ? RECOMMENDATION_UNAVAILABLE_MESSAGE
                      : undefined
                  }
                />
              </div>
            )}
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

      <ConfirmModal
        isOpen={showClearFavConfirm}
        title='确认清空收藏夹？'
        message='该操作会删除所有收藏内容，删除后无法恢复。'
        danger
        cancelText='再想想'
        confirmText='确认清空'
        onCancel={() => setShowClearFavConfirm(false)}
        onConfirm={async () => {
          await clearAllFavorites();
          setFavoriteItems([]);
          setShowClearFavConfirm(false);
        }}
      />
    </PageLayout>
  );
}
