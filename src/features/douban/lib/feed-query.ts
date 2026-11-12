import {
  type BangumiCalendarData,
  GetBangumiCalendarDataWithMeta,
} from '@/features/bangumi/lib/bangumi.client';
import { selectBangumiCardCover } from '@/features/bangumi/lib/bangumi-normalize';
import { DOUBAN_PAGE_SIZE } from '@/features/douban/lib/grid-layout';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import type { DoubanItem, DoubanResult } from '@/lib/types';

export interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

export interface FeedQuery {
  type: string;
  primary: string;
  secondary: string;
  filters: Record<string, string>;
  weekday: string;
}

export interface FeedPage {
  items: DoubanItem[];
  hasMore: boolean;
  calendar?: { data: BangumiCalendarData[]; stale: boolean };
}

export const DEFAULT_FEED_FILTERS: Readonly<Record<string, string>> = {
  type: 'all',
  region: 'all',
  year: 'all',
  platform: 'all',
  label: 'all',
  sort: 'T',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function getCurrentWeekday(): string {
  return WEEKDAYS[new Date().getDay()];
}

export function isCalendarQuery(query: Pick<FeedQuery, 'type' | 'primary'>) {
  return query.type === 'anime' && query.primary === '每日放送';
}

function usesFilters(query: FeedQuery) {
  if (query.type === 'anime') return !isCalendarQuery(query);
  return query.type !== 'custom' && query.primary === '全部';
}

// 只取决定请求的字段：日历才区分星期，筛选只在推荐接口生效
export function getFeedQueryKey(query: FeedQuery): string {
  return JSON.stringify([
    query.type,
    query.primary,
    usesFilters(query) ? '' : query.secondary,
    isCalendarQuery(query) ? query.weekday : '',
    usesFilters(query)
      ? Object.keys(query.filters)
          .sort()
          .map((key) => [key, query.filters[key]])
      : [],
  ]);
}

function getCustomDefaults(customCategories: CustomCategory[]) {
  const primary = customCategories.some((category) => category.type === 'movie')
    ? 'movie'
    : 'tv';
  return {
    primary,
    secondary:
      customCategories.find((category) => category.type === primary)?.query ||
      '',
  };
}

export function getDefaultFeedQuery(
  type: string,
  customCategories: CustomCategory[],
  weekday = getCurrentWeekday(),
): FeedQuery {
  const base = { type, filters: { ...DEFAULT_FEED_FILTERS }, weekday };
  switch (type) {
    case 'custom':
      return { ...base, ...getCustomDefaults(customCategories) };
    case 'tv':
      return { ...base, primary: '最近热门', secondary: 'tv' };
    case 'show':
      return { ...base, primary: '最近热门', secondary: 'show' };
    case 'anime':
      return { ...base, primary: '每日放送', secondary: '全部' };
    default:
      return { ...base, primary: '热门', secondary: '全部' };
  }
}

export function withPrimary(
  query: FeedQuery,
  primary: string,
  customCategories: CustomCategory[],
): FeedQuery {
  const next = { ...query, primary, filters: { ...DEFAULT_FEED_FILTERS } };
  if (query.type === 'custom') {
    const first = customCategories.find(
      (category) => category.type === primary,
    );
    return first ? { ...next, secondary: first.query } : next;
  }
  if (
    (query.type === 'tv' || query.type === 'show') &&
    primary === '最近热门'
  ) {
    return { ...next, secondary: query.type };
  }
  return next;
}

// 豆瓣榜单各页独立缓存，排名变动后相邻页会出现同一条目；id 是网格 key，重复会让 React 残留旧卡片
export function appendUniqueItems(
  current: DoubanItem[],
  incoming: DoubanItem[],
): DoubanItem[] {
  const seen = new Set(current.map((item) => item.id));
  const appended = incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return appended.length === 0 ? current : [...current, ...appended];
}

export function uniqueItems(items: DoubanItem[]): DoubanItem[] {
  return appendUniqueItems([], items);
}

export function getBangumiWeekdayItems(
  calendarData: BangumiCalendarData[],
  weekday: string,
): DoubanItem[] | null {
  const weekdayData = calendarData.find((item) => item.weekday.en === weekday);
  if (!weekdayData) {
    return null;
  }

  return uniqueItems(
    weekdayData.items.map((item) => ({
      id: item.id?.toString() || '',
      title: item.name_cn || item.name,
      poster: selectBangumiCardCover(item.images),
      rate: item.rating?.score?.toFixed(1) || '',
      year: item.air_date?.split('-')?.[0] || '',
    })),
  );
}

function toFeedPage(result: DoubanResult): FeedPage {
  if (result.code !== 200) {
    throw new Error(result.message || '获取数据失败');
  }
  return { items: result.list, hasMore: result.list.length !== 0 };
}

async function fetchCalendarPage(weekday: string): Promise<FeedPage> {
  const result = await GetBangumiCalendarDataWithMeta();
  const items = getBangumiWeekdayItems(result.data, weekday);
  if (!items) {
    throw new Error('没有找到对应的日期');
  }
  return {
    items,
    hasMore: false,
    calendar: { data: result.data, stale: result.usedStaleFallback },
  };
}

function getRecommendFilters(query: FeedQuery) {
  return {
    region: query.filters.region || '',
    year: query.filters.year || '',
    platform: query.filters.platform || '',
    sort: query.filters.sort || '',
    label: query.filters.label || '',
  };
}

export async function fetchFeedPage(
  query: FeedQuery,
  page: number,
  customCategories: CustomCategory[],
): Promise<FeedPage> {
  const pageStart = page * DOUBAN_PAGE_SIZE;

  if (isCalendarQuery(query)) {
    return page === 0
      ? fetchCalendarPage(query.weekday)
      : { items: [], hasMore: false };
  }

  if (query.type === 'custom') {
    const category = customCategories.find(
      (cat) => cat.type === query.primary && cat.query === query.secondary,
    );
    if (!category) {
      throw new Error('没有找到对应的分类');
    }
    return toFeedPage(
      await getDoubanList({
        tag: category.query,
        type: category.type,
        pageLimit: DOUBAN_PAGE_SIZE,
        pageStart,
      }),
    );
  }

  if (query.type === 'anime') {
    const series = query.primary === '番剧';
    return toFeedPage(
      await getDoubanRecommends({
        kind: series ? 'tv' : 'movie',
        pageLimit: DOUBAN_PAGE_SIZE,
        pageStart,
        category: '动画',
        format: series ? '电视剧' : '',
        ...getRecommendFilters(query),
      }),
    );
  }

  if (query.primary === '全部') {
    return toFeedPage(
      await getDoubanRecommends({
        kind: query.type === 'show' ? 'tv' : (query.type as 'tv' | 'movie'),
        pageLimit: DOUBAN_PAGE_SIZE,
        pageStart,
        category: query.filters.type || '',
        format:
          query.type === 'show' ? '综艺' : query.type === 'tv' ? '电视剧' : '',
        ...getRecommendFilters(query),
      }),
    );
  }

  const ranked = query.type === 'tv' || query.type === 'show';
  return toFeedPage(
    await getDoubanCategories({
      kind: ranked ? 'tv' : (query.type as 'tv' | 'movie'),
      category: ranked ? query.type : query.primary,
      type: query.secondary,
      pageLimit: DOUBAN_PAGE_SIZE,
      pageStart,
    }),
  );
}
