import { SearchResult } from '@/lib/types';

export type SearchType = 'tv' | 'movie' | '';

// 作品身份：换源候选、搜索聚合与评价共用，改规则会让已存评价匹配不到
export const normalizeWorkTitle = (title: string): string => {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00A0\u3000]+/g, '')
    .replace(/[·•・.。:：,，!！?？'"`~～_\-—]/g, '');
};

export const normalizeWorkYear = (year: string | undefined): string => {
  const trimmed = (year || '').trim();
  return trimmed.toLowerCase() === 'unknown' ? '' : trimmed;
};

const isYearMatched = (resultYear: string, targetYear: string): boolean => {
  if (!targetYear) {
    return true;
  }

  const normalizedResultYear = (resultYear || 'unknown').toLowerCase();
  const normalizedTargetYear = targetYear.toLowerCase();

  return (
    normalizedResultYear === normalizedTargetYear ||
    normalizedResultYear === 'unknown'
  );
};

const isSearchTypeMatched = (
  episodesLength: number,
  searchType: SearchType,
): boolean => {
  if (!searchType) {
    return true;
  }

  if (episodesLength === 0) {
    return true;
  }

  return (
    (searchType === 'tv' && episodesLength > 1) ||
    (searchType === 'movie' && episodesLength === 1)
  );
};

export const filterSourcesForPlayback = (
  results: SearchResult[],
  options: {
    title: string;
    year: string;
    searchType: SearchType;
  },
): SearchResult[] => {
  const normalizedTitle = normalizeWorkTitle(options.title);
  if (!normalizedTitle) {
    return [];
  }

  return results.filter((result) => {
    const normalizedResultTitle = normalizeWorkTitle(result.title);
    const isTitleMatched =
      normalizedResultTitle.length > 0 &&
      normalizedResultTitle === normalizedTitle;

    return (
      isTitleMatched &&
      isYearMatched(result.year, options.year) &&
      isSearchTypeMatched(result.episodes.length, options.searchType)
    );
  });
};
