import { getCachedBangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { getPublicConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { processDoubanImageUrl } from '@/lib/douban-image-url';
import { readServerDoubanImageProxyType } from '@/lib/douban-image-url.server';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import { DoubanItem } from '@/lib/types';

import { HomeInitialData } from './home.types';
import { HOME_RECOMMENDATION_REVALIDATE_SECONDS } from './home-cache';
import {
  type HomeHeroItem,
  parseDoubanCardSubtitle,
  pickHomeHeroItems,
} from './home-hero';

interface DoubanCategoryApiResponse {
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    episodes_info?: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

const homeRecommendations = createSharedServerCache<DoubanCategoryApiResponse>({
  name: 'home-douban-v1',
  ...getServerCacheBudget('douban-route'),
  freshMs: HOME_RECOMMENDATION_REVALIDATE_SECONDS * 1000,
  staleMs: HOME_RECOMMENDATION_REVALIDATE_SECONDS * 1000,
});

const HERO_INTRO_MAX_LENGTH = 300;
// 冷缓存时首页最多为简介等这么久，超时的请求继续在后台回填缓存
const HERO_INTRO_WAIT_MS = 2500;

const heroIntros = createSharedServerCache<string>({
  name: 'home-douban-intro-v1',
  ...getServerCacheBudget('douban-route'),
  freshMs: 24 * 60 * 60 * 1000,
  staleMs: 6 * 24 * 60 * 60 * 1000,
});

interface RecentHotItem extends DoubanItem {
  subtitle: string;
  episodesInfo: string;
}

async function getServerDoubanRecentHot(params: {
  kind: 'movie' | 'tv';
  category: string;
  type: string;
  imageProxyType: string;
  limit?: number;
  start?: number;
}): Promise<RecentHotItem[]> {
  const {
    kind,
    category,
    type,
    imageProxyType,
    limit = 20,
    start = 0,
  } = params;
  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${start}&limit=${limit}&category=${category}&type=${type}`;
  const doubanData = await homeRecommendations.getOrLoad(target, () =>
    fetchDoubanData<DoubanCategoryApiResponse>(target, { cache: 'no-store' }),
  );

  return doubanData.items.map((item) => ({
    id: item.id,
    title: item.title,
    poster: processDoubanImageUrl(
      item.pic?.normal || item.pic?.large || '',
      imageProxyType,
    ),
    rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
    year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    subtitle: item.card_subtitle || '',
    episodesInfo: item.episodes_info || '',
  }));
}

function toDoubanItem({ id, title, poster, rate, year }: RecentHotItem) {
  return { id, title, poster, rate, year };
}

async function loadHeroIntro(item: { id: string; type?: string }) {
  if (!/^\d+$/.test(item.id)) return '';
  const kind = item.type === 'movie' ? 'movie' : 'tv';
  const target = `https://m.douban.com/rexxar/api/v2/${kind}/${item.id}`;
  const load = heroIntros
    .getOrLoad(target, async () => {
      const detail = await fetchDoubanData<{ intro?: string }>(target, {
        cache: 'no-store',
      });
      return (detail.intro || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, HERO_INTRO_MAX_LENGTH);
    })
    .catch(() => '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), HERO_INTRO_WAIT_MS);
  });
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function buildHeroItems(
  hotMovies: RecentHotItem[],
  hotTvShows: RecentHotItem[],
): Promise<HomeHeroItem[]> {
  const picked = pickHomeHeroItems(hotMovies, hotTvShows);
  const intros = await Promise.all(picked.map(loadHeroIntro));
  return picked.map(({ subtitle, episodesInfo, ...item }, index) => ({
    ...item,
    ...parseDoubanCardSubtitle(subtitle),
    episodesInfo: episodesInfo || undefined,
    intro: intros[index] || undefined,
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
    hotMovies: hotMovies.map(toDoubanItem),
    hotTvShows: hotTvShows.map(toDoubanItem),
    hotVarietyShows: hotVarietyShows.map(toDoubanItem),
    bangumiCalendarData,
    heroItems: await buildHeroItems(hotMovies, hotTvShows),
  };
}
