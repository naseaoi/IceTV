import { filterSourcesForPlayback, SearchType } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';

/** 聚合用标题归一化：去除空格、标点、统一大小写 */
export const normalizeTitleForAggregation = (title: string) => {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00A0\u3000]+/g, '')
    .replace(/[·•・.。:：,，!！?？'"`~～_\-—]/g, '');
};

/**
 * "无排序"场景的批次预排序：完全匹配标题优先，其次年份倒序，未知年份最后
 */
export const sortBatchForNoOrder = (
  items: SearchResult[],
  query: string,
): SearchResult[] => {
  return items.slice().sort((a, b) => {
    const aExact = (a.title || '').trim() === query;
    const bExact = (b.title || '').trim() === query;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aNum = Number.parseInt(a.year as string, 10);
    const bNum = Number.parseInt(b.year as string, 10);
    const aValid = !Number.isNaN(aNum);
    const bValid = !Number.isNaN(bNum);
    if (aValid && !bValid) return -1;
    if (!aValid && bValid) return 1;
    if (aValid && bValid) return bNum - aNum;
    return 0;
  });
};

/** 年份排序比较：unknown/空值始终排最后 */
export const compareYear = (
  aYear: string,
  bYear: string,
  order: 'none' | 'asc' | 'desc',
): number => {
  if (order === 'none') return 0;

  const aIsEmpty = !aYear || aYear === 'unknown';
  const bIsEmpty = !bYear || bYear === 'unknown';

  if (aIsEmpty && bIsEmpty) return 0;
  if (aIsEmpty) return 1;
  if (bIsEmpty) return -1;

  const aNum = parseInt(aYear, 10);
  const bNum = parseInt(bYear, 10);

  return order === 'asc' ? aNum - bNum : bNum - aNum;
};

/** 计算聚合组统计信息（集数、来源列表、豆瓣 ID） */
export const computeGroupStats = (
  group: SearchResult[],
): {
  episodes: number;
  source_names: string[];
  douban_id: number | undefined;
} => {
  // 集数：取出现频率最高的集数
  const episodeCountMap = new Map<number, number>();
  group.forEach((g) => {
    const len = g.episodes?.length || 0;
    if (len > 0) episodeCountMap.set(len, (episodeCountMap.get(len) || 0) + 1);
  });
  let maxCount = 0;
  let episodes = 0;
  episodeCountMap.forEach((v, k) => {
    if (v > maxCount) {
      maxCount = v;
      episodes = k;
    }
  });

  // 来源名称：基于可播放源筛选
  const inferredType: SearchType = episodes === 1 ? 'movie' : 'tv';
  const representative = group[0];
  const playableSources = representative
    ? filterSourcesForPlayback(group, {
        title: representative.title || '',
        year: representative.year || '',
        searchType: inferredType,
      })
    : [];

  const sourcesForCount = playableSources.length > 0 ? playableSources : group;

  const source_names = Array.from(
    new Set(sourcesForCount.map((g) => g.source_name).filter(Boolean)),
  ) as string[];

  // 豆瓣 ID：取出现频率最高的
  const doubanCountMap = new Map<number, number>();
  group.forEach((g) => {
    if (g.douban_id && g.douban_id > 0) {
      doubanCountMap.set(
        g.douban_id,
        (doubanCountMap.get(g.douban_id) || 0) + 1,
      );
    }
  });
  let maxDouban = 0;
  let douban_id: number | undefined;
  doubanCountMap.forEach((v, k) => {
    if (v > maxDouban) {
      maxDouban = v;
      douban_id = k;
    }
  });

  return { episodes, source_names, douban_id };
};
