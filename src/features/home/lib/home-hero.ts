import type { DoubanItem } from '@/lib/types';

export interface HomeHeroMeta {
  region?: string;
  genres?: string[];
  directors?: string;
  actors?: string;
}

export interface HomeHeroItem extends DoubanItem, HomeHeroMeta {
  label: string;
  type?: string;
  episodesInfo?: string;
  intro?: string;
}

export const HERO_ITEM_LIMIT = 5;
const HERO_MIN_RATE = 7;

function rateOf(item: DoubanItem): number {
  return Number.parseFloat(item.rate) || 0;
}

// 电影与剧集交替取高分条目，凑不满时再按热门顺序补齐
export function pickHomeHeroItems<T extends DoubanItem>(
  hotMovies: T[],
  hotTvShows: T[],
): Array<T & Pick<HomeHeroItem, 'label' | 'type'>> {
  const movies = hotMovies
    .filter((item) => item.poster)
    .map((item) => ({ ...item, label: '电影', type: 'movie' }));
  const tvShows = hotTvShows
    .filter((item) => item.poster)
    .map((item) => ({ ...item, label: '剧集' }));

  const interleaved: Array<T & Pick<HomeHeroItem, 'label' | 'type'>> = [];
  for (let i = 0; i < Math.max(movies.length, tvShows.length); i++) {
    if (movies[i]) interleaved.push(movies[i]);
    if (tvShows[i]) interleaved.push(tvShows[i]);
  }

  const picked = interleaved
    .filter((item) => rateOf(item) >= HERO_MIN_RATE)
    .slice(0, HERO_ITEM_LIMIT);
  const pickedIds = new Set(picked.map((item) => item.id));
  for (const item of interleaved) {
    if (picked.length >= HERO_ITEM_LIMIT) break;
    if (!pickedIds.has(item.id)) picked.push(item);
  }

  return picked;
}

// 豆瓣卡片副标题形如「2026 / 中国大陆 / 剧情 爱情 / 导演 / 主演 主演」
export function parseDoubanCardSubtitle(subtitle: string): HomeHeroMeta {
  const segments = subtitle
    .split(' / ')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (/^\d{4}$/.test(segments[0] ?? '')) segments.shift();
  const [region, genres, directors, actors] = segments;

  return {
    region: region || undefined,
    genres: genres ? genres.split(/\s+/) : undefined,
    directors: directors || undefined,
    actors: actors || undefined,
  };
}
