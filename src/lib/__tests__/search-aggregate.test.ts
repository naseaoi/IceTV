import { searchFromApi } from '@/lib/downstream';
import { runSearchAggregation } from '@/lib/search-aggregate';
import type { SearchResult } from '@/lib/types';

jest.mock('@/lib/downstream', () => ({
  searchFromApi: jest.fn(),
}));

function createResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || partial.title || 'id',
    title: partial.title || '',
    poster: '',
    episodes: ['https://example.com/video.m3u8'],
    episodes_titles: ['1'],
    source: 'test',
    source_name: '测试源',
    class: '',
    year: 'unknown',
    desc: '',
    type_name: '动漫',
    douban_id: 0,
    ...partial,
  };
}

describe('runSearchAggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('按连续标题短语过滤搜索结果', async () => {
    (searchFromApi as jest.Mock).mockResolvedValue([
      createResult({ title: '从零开始' }),
      createResult({ title: 'Re：从零开始的异世界生活' }),
      createResult({ title: '八零神豪：从伪装海归开始' }),
    ]);

    const results = await runSearchAggregation({
      apiSites: [
        {
          key: 'test',
          name: '测试源',
          api: 'https://api.example',
        },
      ],
      query: '从零开始',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
    });

    expect(results.map((item) => item.title)).toEqual([
      '从零开始',
      'Re：从零开始的异世界生活',
    ]);
  });
});
