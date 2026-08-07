import {
  clearSearchCachesForTests,
  getCachedSearchPage,
  getSearchCacheStats,
  setCachedSearchPage,
} from '../search-cache';

const SOURCE_KEY = 'source-cache-test';

describe('search cache', () => {
  afterEach(() => {
    clearSearchCachesForTests();
    jest.restoreAllMocks();
  });

  it('keeps empty successful search pages for a short ttl', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);

    setCachedSearchPage(SOURCE_KEY, 'empty-result', 1, 'ok', []);
    expect(getCachedSearchPage(SOURCE_KEY, 'empty-result', 1)).not.toBeNull();

    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

    expect(getCachedSearchPage(SOURCE_KEY, 'empty-result', 1)).toBeNull();
  });

  it('keeps non-empty successful search pages for the normal ttl', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);

    setCachedSearchPage(SOURCE_KEY, 'full-result', 1, 'ok', [
      {
        id: '1',
        title: 'Demo',
        poster: '',
        episodes: ['https://example.com/1.m3u8'],
        episodes_titles: ['1'],
        source: SOURCE_KEY,
        source_name: 'Source',
        year: '2026',
      },
    ]);

    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

    expect(getCachedSearchPage(SOURCE_KEY, 'full-result', 1)).not.toBeNull();
  });

  it('skips a search page larger than the byte budget', () => {
    const oversizedTitle = 'x'.repeat(33 * 1024 * 1024);
    const oversizedSkipsBefore = getSearchCacheStats().pages.oversizedSkips;

    setCachedSearchPage(SOURCE_KEY, 'oversized-result', 1, 'ok', [
      {
        id: 'oversized',
        title: oversizedTitle,
        poster: '',
        episodes: [],
        episodes_titles: [],
        source: SOURCE_KEY,
        source_name: 'Source',
        year: '2026',
      },
    ]);

    expect(getCachedSearchPage(SOURCE_KEY, 'oversized-result', 1)).toBeNull();
    expect(getSearchCacheStats().pages.oversizedSkips).toBe(
      oversizedSkipsBefore + 1,
    );
  });
});
