import { GetBangumiCalendarDataWithMeta } from '@/features/bangumi/lib/bangumi.client';
import {
  type CustomCategory,
  DEFAULT_FEED_FILTERS,
  fetchFeedPage,
  getDefaultFeedQuery,
  getFeedQueryKey,
  withPrimary,
} from '@/features/douban/lib/feed-query';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';

jest.mock('@/features/bangumi/lib/bangumi.client', () => ({
  GetBangumiCalendarDataWithMeta: jest.fn(),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanList: jest.fn(),
  getDoubanRecommends: jest.fn(),
}));

const okPage = {
  code: 200,
  message: 'ok',
  list: [{ id: '1', title: 't', poster: '', rate: '', year: '' }],
};

const customCategories: CustomCategory[] = [
  { name: '高分', type: 'tv', query: '高分剧' },
  { name: '科幻', type: 'movie', query: '科幻' },
];

describe('getFeedQueryKey', () => {
  it('ignores weekday outside the calendar and filters outside 全部', () => {
    const base = getDefaultFeedQuery('movie', [], 'Mon');
    expect(getFeedQueryKey({ ...base, weekday: 'Tue' })).toBe(
      getFeedQueryKey(base),
    );
    expect(
      getFeedQueryKey({
        ...base,
        filters: { ...base.filters, region: '华语' },
      }),
    ).toBe(getFeedQueryKey(base));
  });

  it('distinguishes weekdays for the calendar', () => {
    const base = getDefaultFeedQuery('anime', [], 'Mon');
    expect(getFeedQueryKey({ ...base, weekday: 'Tue' })).not.toBe(
      getFeedQueryKey(base),
    );
  });

  it('distinguishes filters but ignores secondary and key order for 全部', () => {
    const base = { ...getDefaultFeedQuery('movie', []), primary: '全部' };
    const reordered = Object.fromEntries(
      Object.entries(base.filters).reverse(),
    );
    expect(
      getFeedQueryKey({ ...base, secondary: '华语', filters: reordered }),
    ).toBe(getFeedQueryKey(base));
    expect(
      getFeedQueryKey({
        ...base,
        filters: { ...base.filters, region: '华语' },
      }),
    ).not.toBe(getFeedQueryKey(base));
  });
});

describe('withPrimary', () => {
  it('resets filters and restores the ranking secondary for tv', () => {
    const query = {
      ...getDefaultFeedQuery('tv', []),
      primary: '全部',
      secondary: 'tv_american',
      filters: { ...DEFAULT_FEED_FILTERS, region: '华语' },
    };
    const next = withPrimary(query, '最近热门', []);
    expect(next.secondary).toBe('tv');
    expect(next.filters).toEqual(DEFAULT_FEED_FILTERS);
  });

  it('picks the first custom category of the chosen kind', () => {
    const query = getDefaultFeedQuery('custom', customCategories);
    expect(query).toMatchObject({ primary: 'movie', secondary: '科幻' });
    expect(withPrimary(query, 'tv', customCategories)).toMatchObject({
      primary: 'tv',
      secondary: '高分剧',
    });
  });
});

describe('fetchFeedPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDoubanCategories as jest.Mock).mockResolvedValue(okPage);
    (getDoubanList as jest.Mock).mockResolvedValue(okPage);
    (getDoubanRecommends as jest.Mock).mockResolvedValue(okPage);
  });

  it('maps movie rankings to categories with the page offset', async () => {
    const query = { ...getDefaultFeedQuery('movie', []), secondary: '华语' };
    const page = await fetchFeedPage(query, 2, []);
    expect(getDoubanCategories).toHaveBeenCalledWith({
      kind: 'movie',
      category: '热门',
      type: '华语',
      pageLimit: 25,
      pageStart: 50,
    });
    expect(page).toEqual({ items: okPage.list, hasMore: true });
  });

  it('maps tv and show rankings to the tv kind', async () => {
    await fetchFeedPage(
      { ...getDefaultFeedQuery('show', []), secondary: 'show_domestic' },
      0,
      [],
    );
    expect(getDoubanCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tv',
        category: 'show',
        type: 'show_domestic',
      }),
    );
  });

  it('maps 全部 to recommends with filters', async () => {
    const query = {
      ...getDefaultFeedQuery('tv', []),
      primary: '全部',
      filters: { ...DEFAULT_FEED_FILTERS, type: '喜剧', region: '华语' },
    };
    await fetchFeedPage(query, 1, []);
    expect(getDoubanRecommends).toHaveBeenCalledWith({
      kind: 'tv',
      pageLimit: 25,
      pageStart: 25,
      category: '喜剧',
      format: '电视剧',
      region: '华语',
      year: 'all',
      platform: 'all',
      sort: 'T',
      label: 'all',
    });
  });

  it('maps anime series to animated tv recommends', async () => {
    await fetchFeedPage(
      { ...getDefaultFeedQuery('anime', []), primary: '番剧' },
      0,
      [],
    );
    expect(getDoubanRecommends).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tv',
        category: '动画',
        format: '电视剧',
      }),
    );
  });

  it('maps custom categories to the list endpoint', async () => {
    const query = getDefaultFeedQuery('custom', customCategories);
    await fetchFeedPage(query, 0, customCategories);
    expect(getDoubanList).toHaveBeenCalledWith({
      tag: '科幻',
      type: 'movie',
      pageLimit: 25,
      pageStart: 0,
    });
  });

  it('serves the whole calendar on page 0 and nothing after', async () => {
    (GetBangumiCalendarDataWithMeta as jest.Mock).mockResolvedValue({
      data: [
        {
          weekday: { en: 'Mon' },
          items: [{ id: 7, name: 'n', name_cn: '中文', images: { large: '' } }],
        },
      ],
      usedStaleFallback: true,
    });
    const query = getDefaultFeedQuery('anime', [], 'Mon');

    const first = await fetchFeedPage(query, 0, []);
    expect(first.items.map((item) => item.id)).toEqual(['7']);
    expect(first.hasMore).toBe(false);
    expect(first.calendar?.stale).toBe(true);

    await expect(fetchFeedPage(query, 1, [])).resolves.toEqual({
      items: [],
      hasMore: false,
    });
    expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1);
  });

  it('reports the end of the list and rejects failed responses', async () => {
    (getDoubanCategories as jest.Mock)
      .mockResolvedValueOnce({ code: 200, message: 'ok', list: [] })
      .mockResolvedValueOnce({ code: 500, message: '上游失败', list: [] });
    const query = getDefaultFeedQuery('movie', []);

    await expect(fetchFeedPage(query, 0, [])).resolves.toEqual({
      items: [],
      hasMore: false,
    });
    await expect(fetchFeedPage(query, 0, [])).rejects.toThrow('上游失败');
  });
});
