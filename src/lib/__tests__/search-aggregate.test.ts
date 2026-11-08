import { searchFromApi } from '@/lib/downstream';
import {
  clearSearchSourceFailureCooldownsForTests,
  getUpstreamSearchGateStats,
  runSearchAggregation,
} from '@/lib/search-aggregate';
import { ResourceLimitError } from '@/lib/server-resource-errors';
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

  it('单源超时用传入的预算而非固定值', async () => {
    jest.useFakeTimers();
    const onSourceError = jest.fn();
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    (searchFromApi as jest.Mock).mockImplementation(
      () => new Promise(() => undefined),
    );

    const pending = runSearchAggregation({
      apiSites: [{ key: 'slow', name: '慢源', api: 'https://api.example' }],
      query: '慢',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
      sourceTimeoutMs: 500,
      onSourceError,
    });

    await Promise.resolve();
    jest.advanceTimersByTime(499);
    expect(onSourceError).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2);
    await expect(pending).resolves.toEqual([]);
    expect(onSourceError).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '搜索失败 慢源:',
      '慢源 timeout',
    );
  });

  it('闸门释放后后续搜索仍可正常发起', async () => {
    (searchFromApi as jest.Mock).mockResolvedValue([
      createResult({ title: '闸门' }),
    ]);
    const apiSites = Array.from({ length: 20 }, (_, index) => ({
      key: `s${index}`,
      name: `源${index}`,
      api: 'https://api.example',
    }));

    for (let round = 0; round < 2; round += 1) {
      const results = await runSearchAggregation({
        apiSites,
        query: '闸门',
        maxSearchPages: 1,
        disableYellowFilter: true,
        sourceConcurrency: 6,
      });
      expect(results).toHaveLength(20);
    }

    const stats = getUpstreamSearchGateStats();
    expect(stats.active).toBe(0);
    expect(stats.waiting).toBe(0);
  });

  it('闸门上限跟随传入的源并发', async () => {
    (searchFromApi as jest.Mock).mockResolvedValue([]);
    const apiSites = [
      { key: 'gate', name: '闸门源', api: 'https://api.example' },
    ];

    await runSearchAggregation({
      apiSites,
      query: '并发',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 3,
    });
    expect(getUpstreamSearchGateStats().limit).toBe(3);

    await runSearchAggregation({
      apiSites,
      query: '并发',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 9,
    });
    expect(getUpstreamSearchGateStats().limit).toBe(9);
  });
});

describe('source health search budgets', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    clearSearchSourceFailureCooldownsForTests();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([3000, 12000])(
    'caps only offline sources within the %i ms budget',
    async (sourceTimeoutMs) => {
      const signals = new Map<string, AbortSignal>();
      (searchFromApi as jest.Mock).mockImplementation(
        (site, _query, options) => {
          signals.set(site.key, options.signal);
          return new Promise(() => {});
        },
      );
      const onSourceError = jest.fn();
      const pending = runSearchAggregation({
        apiSites: ['offline', 'poor', 'unknown'].map((key) => ({
          key,
          name: key,
          api: 'https://example.com',
        })),
        query: 'test',
        maxSearchPages: 1,
        disableYellowFilter: true,
        sourceConcurrency: 3,
        sourceTimeoutMs,
        sourceHealthTiers: new Map([
          ['offline', 'offline'],
          ['poor', 'poor'],
        ]),
        onSourceError,
      });
      await Promise.resolve();
      jest.advanceTimersByTime(Math.min(sourceTimeoutMs, 5000) - 1);
      expect(onSourceError).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(signals.get('offline')?.aborted).toBe(true);
      expect(signals.get('poor')?.aborted).toBe(sourceTimeoutMs <= 5000);
      expect(signals.get('unknown')?.aborted).toBe(sourceTimeoutMs <= 5000);
      jest.advanceTimersByTime(sourceTimeoutMs);
      await expect(pending).resolves.toEqual([]);
      expect(searchFromApi).toHaveBeenCalledTimes(3);
    },
  );

  it('闸门排队超时按繁忙报错且不进入源失败冷却', async () => {
    let finishHolder: (value: SearchResult[]) => void = () => {};
    (searchFromApi as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          finishHolder = resolve;
        }),
    );
    const base = {
      query: 'test',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
      sourceTimeoutMs: 120_000,
    };
    const holder = runSearchAggregation({
      ...base,
      apiSites: [{ key: 'a', name: 'a', api: 'https://a.example' }],
    });
    await Promise.resolve();

    const onSourceError = jest.fn();
    const queued = runSearchAggregation({
      ...base,
      apiSites: [{ key: 'b', name: 'b', api: 'https://b.example' }],
      onSourceError,
    });
    await Promise.resolve();
    expect(getUpstreamSearchGateStats().waiting).toBe(1);

    jest.advanceTimersByTime(30_000);
    await expect(queued).resolves.toEqual([]);
    expect(onSourceError.mock.calls[0][1]).toBeInstanceOf(ResourceLimitError);
    expect(getUpstreamSearchGateStats().waiting).toBe(0);

    finishHolder([]);
    await holder;
    (searchFromApi as jest.Mock).mockResolvedValueOnce([]);
    await runSearchAggregation({
      ...base,
      apiSites: [{ key: 'b', name: 'b', api: 'https://b.example' }],
    });
    expect(searchFromApi).toHaveBeenCalledTimes(2);
  });

  it('returns scheduling order despite reverse completion', async () => {
    (searchFromApi as jest.Mock).mockImplementation(
      (site) =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([createResult({ source: site.key, title: 'test' })]),
            site.key === 'good' ? 100 : 1,
          );
        }),
    );
    const completed: string[] = [];
    const pending = runSearchAggregation({
      apiSites: ['good', 'poor'].map((key) => ({
        key,
        name: key,
        api: 'https://example.com',
      })),
      query: 'test',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 2,
      onSourceResult: (site) => completed.push(site.key),
    });
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    const results = await pending;
    expect(completed).toEqual(['poor', 'good']);
    expect(results.map((item) => item.source)).toEqual(['good', 'poor']);
  });
});
