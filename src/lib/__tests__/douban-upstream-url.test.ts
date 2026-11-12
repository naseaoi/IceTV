import {
  buildDoubanRecentHotUrl,
  buildDoubanRecommendUrl,
  buildDoubanSearchSubjectsUrl,
} from '../douban-upstream-url';

describe('douban upstream urls', () => {
  it('encodes recent hot categories so reserved characters stay in one value', () => {
    const url = new URL(
      buildDoubanRecentHotUrl({
        kind: 'tv',
        category: 'tv',
        type: 'tv_a&b=c',
        start: 25,
        limit: 25,
      }),
    );

    expect(url.origin).toBe('https://m.douban.com');
    expect(url.pathname).toBe('/rexxar/api/v2/subject/recent_hot/tv');
    expect(url.searchParams.get('type')).toBe('tv_a&b=c');
    expect(url.searchParams.get('b')).toBeNull();
    expect(url.searchParams.get('start')).toBe('25');
  });

  it('encodes custom list tags and switches mirror hosts', () => {
    const url = new URL(
      buildDoubanSearchSubjectsUrl(
        { type: 'movie', tag: '科幻 & 悬疑', start: 0, limit: 25 },
        'cmliussss-ali',
      ),
    );

    expect(url.origin).toBe('https://movie.douban.cmliussss.com');
    expect(url.searchParams.get('tag')).toBe('科幻 & 悬疑');
    expect(url.searchParams.get('page_limit')).toBe('25');
  });

  it('drops "all" filters and the default sort from recommend queries', () => {
    const url = new URL(
      buildDoubanRecommendUrl({
        kind: 'tv',
        start: 0,
        limit: 25,
        category: 'all',
        format: '电视剧',
        region: '日本',
        year: 'all',
        label: 'all',
        platform: '',
        sort: 'T',
      }),
    );

    expect(url.searchParams.get('tags')).toBe('电视剧,日本');
    expect(JSON.parse(url.searchParams.get('selected_categories')!)).toEqual({
      类型: '',
      形式: '电视剧',
      地区: '日本',
    });
    expect(url.searchParams.has('sort')).toBe(false);
  });
});
