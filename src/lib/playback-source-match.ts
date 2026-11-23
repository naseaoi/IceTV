import { simplifySearchText } from '@/lib/search-text';
import type { SearchType } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';
import { normalizeWorkTitle } from '@/lib/work-identity';

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
  const normalizedTitle = normalizeWorkTitle(simplifySearchText(options.title));
  if (!normalizedTitle) {
    return [];
  }

  return results.filter((result) => {
    const normalizedResultTitle = normalizeWorkTitle(
      simplifySearchText(result.title),
    );
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
