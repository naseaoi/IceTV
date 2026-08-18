import {
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchQueryInput,
  shouldRequestSearchSuggestions,
} from './searchQuery';

describe('normalizeSearchQueryInput', () => {
  it('removes invisible characters and normalizes spacing', () => {
    expect(normalizeSearchQueryInput('\u200b《对魔导\u3000学园》\ufeff')).toBe(
      '《对魔导 学园》',
    );
  });

  it('limits normalized queries and suggestion lookups', () => {
    expect(normalizeSearchQueryInput('a'.repeat(100))).toHaveLength(
      MAX_SEARCH_QUERY_LENGTH,
    );
    expect(shouldRequestSearchSuggestions('影')).toBe(false);
    expect(shouldRequestSearchSuggestions('电影')).toBe(true);
  });
});
