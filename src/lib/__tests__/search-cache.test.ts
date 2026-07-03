import { getCachedSearchPage, setCachedSearchPage } from '../search-cache';

const SOURCE_KEY = 'source-cache-test';

describe('search cache', () => {
  afterEach(() => {
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
});
