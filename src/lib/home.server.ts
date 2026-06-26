import { getBangumiCalendarData } from './bangumi';
import { fetchDoubanData } from './douban';
import { HomeInitialData } from './home.types';
import { DoubanItem } from './types';

const HOME_REVALIDATE_SECONDS = 21600;

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
  limit?: number;
  start?: number;
}): Promise<DoubanItem[]> {
  const { kind, category, type, limit = 20, start = 0 } = params;
  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${start}&limit=${limit}&category=${category}&type=${type}`;
  const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(target, {
    next: { revalidate: HOME_REVALIDATE_SECONDS },
  });

  return doubanData.items.map((item) => ({
    id: item.id,
    title: item.title,
    poster: item.pic?.normal || item.pic?.large || '',
    rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
    year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
  }));
}

export async function getHomeInitialData(): Promise<HomeInitialData> {
  try {
    const [hotMovies, hotTvShows, hotVarietyShows, bangumiCalendarData] =
      await Promise.all([
        getServerDoubanRecentHot({
          kind: 'movie',
          category: '热门',
          type: '全部',
        }),
        getServerDoubanRecentHot({
          kind: 'tv',
          category: 'tv',
          type: 'tv',
        }),
        getServerDoubanRecentHot({
          kind: 'tv',
          category: 'show',
          type: 'show',
        }),
        getBangumiCalendarData({
          next: { revalidate: HOME_REVALIDATE_SECONDS },
        }),
      ]);

    return {
      hotMovies,
      hotTvShows,
      hotVarietyShows,
      bangumiCalendarData,
    };
  } catch {
    return {
      hotMovies: [],
      hotTvShows: [],
      hotVarietyShows: [],
      bangumiCalendarData: [],
    };
  }
}
