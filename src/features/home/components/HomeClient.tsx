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

import { getBangumiCalendarData } from '@/lib/bangumi';
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { HomeInitialData } from '@/lib/home.types';
import { DoubanItem } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import ConfirmModal from '@/components/modals/ConfirmModal';
import InfoModal from '@/components/modals/InfoModal';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

interface HomeClientProps {
  initialData: HomeInitialData;
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

function RecommendationSkeletonRow() {
  return Array.from({ length: 8 }).map((_, index) => (
    <div key={index} className='w-24 min-w-[96px] sm:w-44 sm:min-w-[180px]'>
      <div className='relative aspect-[2/3] w-full animate-pulse overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
        <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
      </div>
      <div className='mt-2 h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800'></div>
    </div>
  ));
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
        {loading
          ? RecommendationSkeletonRow()
          : items.map((item, index) => (
              <div
                key={item.id}
                className='w-24 min-w-[96px] sm:w-44 sm:min-w-[180px]'
              >
                <VideoCard
                  from='douban'
                  title={item.title}
                  poster={item.poster}
                  douban_id={Number(item.id)}
                  rate={item.rate}
                  year={item.year}
                  type={type}
                  isBangumi={isBangumi}
                  priority={index < priorityCount}
                />
              </div>
            ))}
      </ScrollableRow>
    </section>
  );
}

export default function HomeClient({ initialData }: HomeClientProps) {
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
  const [loading, setLoading] = useState(
    !(
      initialData.hotMovies.length > 0 ||
      initialData.hotTvShows.length > 0 ||
      initialData.hotVarietyShows.length > 0 ||
      initialData.bangumiCalendarData.length > 0
    ),
  );
  const { announcement } = useSite();

  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showClearFavConfirm, setShowClearFavConfirm] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  useEffect(() => {
    // ISR 已提供有效数据时跳过客户端重复请求，节省带宽和加载时间
    const hasInitialData =
      initialData.hotMovies.length > 0 ||
      initialData.hotTvShows.length > 0 ||
      initialData.hotVarietyShows.length > 0 ||
      initialData.bangumiCalendarData.length > 0;

    if (hasInitialData) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const refreshRecommendData = async () => {
      try {
        const [moviesData, tvShowsData, varietyShowsData, bangumiData] =
          await Promise.all([
            getDoubanCategories({
              kind: 'movie',
              category: '热门',
              type: '全部',
            }),
            getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
            getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
            getBangumiCalendarData(),
          ]);

        if (cancelled) {
          return;
        }

        if (moviesData.code === 200) {
          setHotMovies(moviesData.list);
        }
        if (tvShowsData.code === 200) {
          setHotTvShows(tvShowsData.list);
        }
        if (varietyShowsData.code === 200) {
          setHotVarietyShows(varietyShowsData.list);
        }

        setBangumiCalendarData(bangumiData);
      } catch (error) {
        console.error('获取推荐数据失败:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    refreshRecommendData();

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

  const todayAnimes = useMemo(() => {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekday = weekdays[new Date().getDay()];
    const items =
      bangumiCalendarData.find((item) => item.weekday.en === currentWeekday)
        ?.items || [];

    return items.map((anime) => ({
      id: anime.id.toString(),
      title: anime.name_cn || anime.name,
      poster:
        anime.images.large ||
        anime.images.common ||
        anime.images.medium ||
        anime.images.small ||
        anime.images.grid,
      rate: anime.rating?.score?.toFixed(1) || '',
      year: anime.air_date?.split('-')?.[0] || '',
    }));
  }, [bangumiCalendarData]);

  const handleCloseAnnouncement = (currentAnnouncement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', currentAnnouncement);
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
                <ContinueWatching />

                <RecommendationSection
                  title='热门电影'
                  href='/douban?type=movie'
                  icon={Film}
                  iconClassName='h-5 w-5 text-blue-500'
                  items={hotMovies}
                  loading={loading && hotMovies.length === 0}
                  type='movie'
                  priorityCount={4}
                />

                <RecommendationSection
                  title='热门剧集'
                  href='/douban?type=tv'
                  icon={Tv}
                  iconClassName='h-5 w-5 text-emerald-500'
                  items={hotTvShows}
                  loading={loading && hotTvShows.length === 0}
                />

                <RecommendationSection
                  title='新番放送'
                  href='/douban?type=anime'
                  icon={Cat}
                  iconClassName='h-5 w-5 text-pink-500'
                  items={todayAnimes}
                  loading={loading && todayAnimes.length === 0}
                  isBangumi={true}
                />

                <RecommendationSection
                  title='热门综艺'
                  href='/douban?type=show'
                  icon={Clover}
                  iconClassName='h-5 w-5 text-violet-500'
                  items={hotVarietyShows}
                  loading={loading && hotVarietyShows.length === 0}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {announcement && (
        <InfoModal
          isOpen={showAnnouncement}
          title='提示'
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
