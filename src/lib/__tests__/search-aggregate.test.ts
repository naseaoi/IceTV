import { searchFromApi } from '@/lib/downstream';
import {
  clearSearchSourceFailureCooldownsForTests,
  runSearchAggregation,
} from '@/lib/search-aggregate';
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
  const originalCooldown = process.env.SEARCH_SOURCE_FAILURE_COOLDOWN_MS;

  beforeEach(() => {
    jest.clearAllMocks();
    clearSearchSourceFailureCooldownsForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCooldown === undefined) {
      delete process.env.SEARCH_SOURCE_FAILURE_COOLDOWN_MS;
    } else {
      process.env.SEARCH_SOURCE_FAILURE_COOLDOWN_MS = originalCooldown;
    }
    jest.useRealTimers();
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

  it('skips failed sources during server cooldown', async () => {
    process.env.SEARCH_SOURCE_FAILURE_COOLDOWN_MS = '1000';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const site = {
      key: 'failed',
      name: '失败源',
      api: 'https://api.example',
    };
    const onSourceError = jest.fn();
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    (searchFromApi as jest.Mock)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue([createResult({ title: '恢复' })]);

    await runSearchAggregation({
      apiSites: [site],
      query: '恢复',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
      onSourceError,
    });
    await runSearchAggregation({
      apiSites: [site],
      query: '恢复',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
      onSourceError,
    });

    expect(searchFromApi).toHaveBeenCalledTimes(1);
    expect(onSourceError).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1001);
    const results = await runSearchAggregation({
      apiSites: [site],
      query: '恢复',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
      onSourceError,
    });

    expect(searchFromApi).toHaveBeenCalledTimes(2);
    expect(results.map((item) => item.title)).toEqual(['恢复']);
    expect(consoleWarnSpy).toHaveBeenCalledWith('搜索失败 失败源:', 'timeout');
  });
});
