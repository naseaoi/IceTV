import { computeGroupStats } from '@/features/search/lib/searchUtils';
import {
  isTitleMatchedSearchQuery,
  normalizeSearchMatchText,
  simplifySearchText,
} from '@/lib/search-text';
import {
  filterSourcesForPlayback,
  normalizeWorkTitle,
  normalizeWorkYear,
} from '@/lib/source-match';
import type { SearchResult } from '@/lib/types';

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'one',
    source: 'one',
    source_name: '源一',
    title: '海賊王',
    year: '2026',
    poster: '',
    episodes: ['one', 'two'],
    episodes_titles: ['1', '2'],
    ...overrides,
  };
}

it('作品身份保留简繁差异与原有归一化规则', () => {
  expect(normalizeWorkTitle(' ＡＢＣ：海賊王· ')).toBe('abc海賊王');
  expect(normalizeWorkTitle('海賊王')).not.toBe(normalizeWorkTitle('海贼王'));
  expect(normalizeWorkYear(' UNKNOWN ')).toBe('');
  expect(normalizeWorkYear(undefined)).toBe('');
  expect(normalizeWorkYear(' 2026 ')).toBe('2026');
});

it.each(['海贼王', '海賊王'])(
  '同步与动态筛选对 %s 保持标题、年份和类型规则',
  async (title) => {
    const candidates = [
      source(),
      source({ id: 'unknown', title: '海贼王', year: 'unknown', episodes: [] }),
      source({ id: 'wrong-year', year: '2025' }),
      source({ id: 'movie', episodes: ['one'] }),
      source({ id: 'other', title: '海贼王特别篇' }),
    ];
    const options = { title, year: '2026', searchType: 'tv' as const };
    const expected = candidates.slice(0, 2);
    expect(filterSourcesForPlayback(candidates, options)).toEqual(expected);
    const lazy = await import('@/lib/playback-source-match');
    expect(lazy.filterSourcesForPlayback(candidates, options)).toEqual(
      expected,
    );
    expect(expected[0].title).toBe('海賊王');
    expect(
      filterSourcesForPlayback(candidates, { ...options, title: ' ' }),
    ).toEqual([]);
  },
);

it('聚合统计使用按需加载的筛选函数并保留简繁来源', async () => {
  const matcher = await import('@/lib/playback-source-match');
  const group = [source(), source({ title: '海贼王', source_name: '源二' })];
  expect(computeGroupStats(group, matcher.filterSourcesForPlayback)).toEqual({
    episodes: 2,
    source_names: ['源一', '源二'],
    douban_id: undefined,
  });
});

it('搜索文本接口保留简繁转换、标点归一化与包含匹配', () => {
  expect(simplifySearchText('海賊王')).toBe('海贼王');
  expect(normalizeSearchMatchText('《Ａ：海賊王》')).toBe('a海贼王');
  expect(isTitleMatchedSearchQuery('海賊王 特别篇', '海贼王')).toBe(true);
  expect(isTitleMatchedSearchQuery('海贼王 特别篇', '海賊王')).toBe(true);
  expect(isTitleMatchedSearchQuery('海賊王', '')).toBe(true);
});

it('导入身份模块与搜索工具时不构建转换表，首次匹配仅创建一次', () => {
  const converter = jest.fn(() => (text: string) => text);
  jest.isolateModules(() => {
    jest.doMock('opencc-js/t2cn', () => ({ Converter: converter }));
    const identity =
      jest.requireActual<typeof import('@/lib/source-match')>(
        '@/lib/source-match',
      );
    const text =
      jest.requireActual<typeof import('@/lib/search-text')>(
        '@/lib/search-text',
      );
    const utils = jest.requireActual<
      typeof import('@/features/search/lib/searchUtils')
    >('@/features/search/lib/searchUtils');
    identity.normalizeWorkTitle('海賊王');
    utils.sortBatchForNoOrder([], '海賊王');
    expect(converter).not.toHaveBeenCalled();
    text.simplifySearchText('海賊王');
    text.normalizeSearchMatchText('海贼王');
    expect(converter).toHaveBeenCalledTimes(1);
  });
  jest.dontMock('opencc-js/t2cn');
});
