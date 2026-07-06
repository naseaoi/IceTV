import { getCachedBangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { getPublicConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { processDoubanImageUrl } from '@/lib/douban-image-url';
import { readServerDoubanImageProxyType } from '@/lib/douban-image-url.server';
import { DoubanItem } from '@/lib/types';

import { HomeInitialData } from './home.types';
import { HOME_RECOMMENDATION_REVALIDATE_SECONDS } from './home-cache';

interface DoubanCategoryApiResponse {
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

async function getServerDoubanRecentHot(params: {
  kind: 'movie' | 'tv';
  category: string;
  type: string;
  imageProxyType: string;
  limit?: number;
  start?: number;
}): Promise<DoubanItem[]> {
  const {
    kind,
    category,
    type,
    imageProxyType,
    limit = 20,
    start = 0,
  } = params;
  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${start}&limit=${limit}&category=${category}&type=${type}`;
  const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(target, {
    next: { revalidate: HOME_RECOMMENDATION_REVALIDATE_SECONDS },
  });

  return doubanData.items.map((item) => ({
    id: item.id,
    title: item.title,
    poster: processDoubanImageUrl(
      item.pic?.normal || item.pic?.large || '',
      imageProxyType,
    ),
    rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
    year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
  }));
}

export async function getHomeInitialData(): Promise<HomeInitialData> {
  const publicConfig = await getPublicConfig();
  const imageProxyType = await readServerDoubanImageProxyType(
    publicConfig.DoubanImageProxyType,
  );
  const [hotMovies, hotTvShows, hotVarietyShows, bangumiCalendarData] =
    await Promise.all([
      getServerDoubanRecentHot({
        kind: 'movie',
        category: '热门',
        type: '全部',
        imageProxyType,
      }).catch(() => []),
      getServerDoubanRecentHot({
        kind: 'tv',
        category: 'tv',
        type: 'tv',
        imageProxyType,
      }).catch(() => []),
      getServerDoubanRecentHot({
        kind: 'tv',
        category: 'show',
        type: 'show',
        imageProxyType,
      }).catch(() => []),
      getCachedBangumiCalendarData({ allowStale: true }) ?? [],
    ]);

  return {
    hotMovies,
    hotTvShows,
    hotVarietyShows,
    bangumiCalendarData,
  };
}
