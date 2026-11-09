import { getBangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { isUsableBangumiCalendarData } from '@/features/bangumi/lib/bangumi-normalize';
import { DOUBAN_PAGE_SIZE } from '@/features/douban/lib/grid-layout';
import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { getPublicConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { processDoubanImageUrl } from '@/lib/douban-image-url';
import { readServerDoubanImageProxyType } from '@/lib/douban-image-url.server';
import { buildDoubanRecentHotUrl } from '@/lib/douban-upstream-url';
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
const HOME_UPSTREAM_WAIT_MS = 800;

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
    // 与分类页同一页大小：首页结果会预填为分类第一页，续取从这里接上
    limit = DOUBAN_PAGE_SIZE,
    start = 0,
  } = params;
  const target = buildDoubanRecentHotUrl({
    kind,
    category,
    type,
    start,
    limit,
  });
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

function loadHeroIntroDetail(target: string) {
  return fetchDoubanData<{ intro?: string }>(target, {
    cache: 'no-store',
  }).then((detail) =>
    (detail.intro || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, HERO_INTRO_MAX_LENGTH),
  );
}

// 首屏只等短暂预算：共享缓存命中即刻返回，冷启动回源超时则本次留空，加载在后台继续写缓存
async function waitWithinBudget<T>(task: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), HOME_UPSTREAM_WAIT_MS);
  });
  try {
    return await Promise.race([task, timeout]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function getHeroIntro(item: {
  id: string;
  type?: string;
}): Promise<string | undefined> {
  if (!/^\d+$/.test(item.id)) return undefined;
  const kind = item.type === 'movie' ? 'movie' : 'tv';
  const target = `https://m.douban.com/rexxar/api/v2/${kind}/${item.id}`;
  return (
    (await waitWithinBudget(
      heroIntros.getOrLoad(target, () => loadHeroIntroDetail(target)),
    )) || undefined
  );
}

function buildHeroItems(
  hotMovies: RecentHotItem[],
  hotTvShows: RecentHotItem[],
): Promise<HomeHeroItem[]> {
  const picked = pickHomeHeroItems(hotMovies, hotTvShows);
  return Promise.all(
    picked.map(async ({ subtitle, episodesInfo, ...item }) => ({
      ...item,
      ...parseDoubanCardSubtitle(subtitle),
      episodesInfo: episodesInfo || undefined,
      intro: await getHeroIntro(item),
    })),
  );
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
      waitWithinBudget(getBangumiCalendarData()).then((data) =>
        data && isUsableBangumiCalendarData(data) ? data : [],
      ),
    ]);

  return {
    hotMovies: hotMovies.map(toDoubanItem),
    hotTvShows: hotTvShows.map(toDoubanItem),
    hotVarietyShows: hotVarietyShows.map(toDoubanItem),
    bangumiCalendarData,
    heroItems: await buildHeroItems(hotMovies, hotTvShows),
  };
}
