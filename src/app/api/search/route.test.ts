/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { getAvailableApiSites } from '@/lib/config';
import { getCachedDetail } from '@/lib/detail-cache';
import { searchFirstPageFromApi } from '@/lib/downstream';
import { runSearchAggregation } from '@/lib/search-aggregate';
import {
  mergeRetriedSearchAggregate,
  peekCachedSearchAggregate,
  setCachedSearchAggregate,
} from '@/lib/search-cache';
import { getSourceHealthTiers } from '@/lib/source-health.server';

installStreamPolyfills();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn().mockResolvedValue({ username: 'demo' }),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn().mockResolvedValue({
    SiteConfig: { DisableYellowFilter: true },
    SourceConfig: [],
  }),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn(),
}));
jest.mock('@/lib/search-aggregate', () => {
  const runSearchAggregation = jest.fn();
  return {
    runSearchAggregation,
    collectSearchAggregation: jest.fn(async (options) => {
      const failedSources: string[] = [];
      const results = await runSearchAggregation({
        ...options,
        onSourceError: (site: { key: string }, error: unknown) => {
          failedSources.push(site.key);
          options.onSourceError?.(site, error);
        },
      });
      return { results, failedSources };
    }),
  };
});
jest.mock('@/lib/search-cache', () => ({
  peekCachedSearchAggregate: jest.fn(),
  loadCachedSearchAggregate: jest.fn((_params, loader) => loader()),
  refreshCachedSearchAggregate: jest.fn((_params, loader) => loader()),
  setCachedSearchAggregate: jest.fn(),
  mergeRetriedSearchAggregate: jest.fn(),
}));
jest.mock('@/lib/downstream', () => ({ searchFirstPageFromApi: jest.fn() }));
jest.mock('@/lib/detail-cache', () => ({ getCachedDetail: jest.fn() }));

const { GET } = require('./route') as typeof import('./route');
const { GET: streamGET } = require('./ws/route') as typeof import('./ws/route');
const { GET: quickGET } =
  require('./quick/route') as typeof import('./quick/route');
const sites = ['offline', 'good-z', 'good-a', 'unknown'].map((key) => ({
  key,
  name: key,
  api: `https://${key}.example.com`,
}));
const tiers = new Map([
  ['offline', 'offline'],
  ['good-z', 'good'],
  ['good-a', 'good'],
  ['forbidden', 'good'],
]);
const request = (search = '?q=test') =>
  ({
    url: `http://localhost/api/search${search}`,
    signal: new AbortController().signal,
  }) as NextRequest;
const readEvents = async (response: Response) =>
  (await response.text())
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.slice(6)));
const video = (source: string) => ({
  source,
  source_name: source,
  id: source,
  title: 'test',
  year: '2026',
  episodes: ['https://example.com/video.m3u8'],
  episodes_titles: ['1'],
  poster: '',
});

beforeEach(() => {
  jest.clearAllMocks();
  (getAvailableApiSites as jest.Mock).mockResolvedValue(sites);
  (getSourceHealthTiers as jest.Mock).mockResolvedValue(tiers);
  (peekCachedSearchAggregate as jest.Mock).mockReturnValue(null);
  (runSearchAggregation as jest.Mock).mockResolvedValue([]);
  (searchFirstPageFromApi as jest.Mock).mockResolvedValue([]);
  (getCachedDetail as jest.Mock).mockResolvedValue(null);
});

it('sorts authorized sites, forwards tiers and keeps cache parameters stable across map order', async () => {
  expect((await GET(request())).status).toBe(200);
  expect(runSearchAggregation).toHaveBeenCalledWith(
    expect.objectContaining({
      apiSites: [sites[1], sites[2], sites[3], sites[0]],
      sourceHealthTiers: tiers,
    }),
  );
  const firstParams = (peekCachedSearchAggregate as jest.Mock).mock.calls[0][0];
  (getSourceHealthTiers as jest.Mock).mockResolvedValueOnce(
    new Map([...tiers].reverse()),
  );
  await GET(request());
  expect((peekCachedSearchAggregate as jest.Mock).mock.calls[1][0]).toEqual(
    firstParams,
  );
});

it('preserves configured source order on the empty health fallback', async () => {
  (getSourceHealthTiers as jest.Mock).mockResolvedValueOnce(new Map());
  await GET(request());
  expect(runSearchAggregation).toHaveBeenCalledWith(
    expect.objectContaining({ apiSites: sites }),
  );
});

it.each([GET, streamGET])(
  'keeps health ordering and timeout tiers in stale refreshes',
  async (handler) => {
    (peekCachedSearchAggregate as jest.Mock).mockReturnValue({
      fresh: false,
      entry: { results: [video('good-z')] },
    });
    const response = await handler(request());
    await response.text();
    expect(runSearchAggregation).toHaveBeenCalledWith(
      expect.objectContaining({
        apiSites: [sites[1], sites[2], sites[3], sites[0]],
        sourceHealthTiers: tiers,
      }),
    );
  },
);

it('streams completion order immediately and supplies canonical source order on completion', async () => {
  (runSearchAggregation as jest.Mock).mockImplementation(async (options) => {
    options.onSourceResult(sites[0], [video('offline')]);
    options.onSourceResult(sites[1], [video('good-z')]);
    return [video('good-z'), video('offline')];
  });
  const response = await streamGET(request());
  const events = (await response.text())
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.slice(6)));
  expect(
    events
      .filter((event) => event.type === 'source_result')
      .map((event) => event.source),
  ).toEqual(['offline', 'good-z']);
  expect(events.at(-1)).toMatchObject({ type: 'complete' });
  expect(
    (runSearchAggregation as jest.Mock).mock.calls
      .at(-1)[0]
      .apiSites.map((site: { key: string }) => site.key),
  ).toEqual(['good-z', 'good-a', 'unknown', 'offline']);
  expect(setCachedSearchAggregate).toHaveBeenCalledWith(expect.anything(), {
    results: [video('good-z'), video('offline')],
    failedSources: [],
  });
  expect(runSearchAggregation).toHaveBeenCalledWith(
    expect.objectContaining({ sourceHealthTiers: tiers }),
  );
});

it('ranks before the quick-search source limit, preserving same-tier order and permissions', async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    key: `source-${index}`,
    name: `source-${index}`,
    api: 'https://example.com',
  }));
  (getAvailableApiSites as jest.Mock).mockResolvedValueOnce(many);
  (getSourceHealthTiers as jest.Mock).mockResolvedValueOnce(
    new Map([
      ['source-11', 'good'],
      ['forbidden', 'good'],
    ]),
  );
  const response = await quickGET(request());
  expect(response.status).toBe(200);
  expect(
    (searchFirstPageFromApi as jest.Mock).mock.calls.map(([site]) => site.key),
  ).toEqual(['source-11', ...many.slice(0, 9).map((site) => site.key)]);
  expect(await response.json()).toMatchObject({ searchedSources: 10 });
});

it('keeps upstream exception details out of source_error events', async () => {
  const error = new Error('https://private.example/?token=secret');
  (runSearchAggregation as jest.Mock).mockImplementationOnce(
    async (options) => {
      options.onSourceError(sites[0], error);
      return [];
    },
  );
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await streamGET(request());
    const text = await response.text();
    const events = text
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.slice(6)));
    expect(events.find((event) => event.type === 'source_error')).toMatchObject(
      {
        source: sites[0].key,
        error: '搜索失败',
      },
    );
    expect(text).not.toContain('secret');
    expect(log).toHaveBeenCalledWith(
      '流式搜索源请求失败:',
      sites[0].key,
      error,
    );
  } finally {
    log.mockRestore();
  }
});

it('reports failed sources from fresh and cached aggregates', async () => {
  (runSearchAggregation as jest.Mock).mockImplementationOnce(
    async (options) => {
      options.onSourceError(sites[0], new Error('timeout'));
      return [video('good-z')];
    },
  );
  expect(await (await GET(request())).json()).toMatchObject({
    totalSources: 4,
    failedSources: [{ key: 'offline', name: 'offline' }],
  });

  (peekCachedSearchAggregate as jest.Mock).mockReturnValue({
    fresh: true,
    entry: { results: [video('good-z')], failedSources: ['offline'] },
  });
  const events = await readEvents(await streamGET(request()));
  expect(events.filter((event) => event.type === 'source_error')).toEqual([
    expect.objectContaining({ source: 'offline', sourceName: 'offline' }),
  ]);
  expect(events.at(-1)).toMatchObject({ type: 'complete' });
});

it('retries only the requested available sources and merges them into the cached aggregate', async () => {
  (runSearchAggregation as jest.Mock).mockImplementationOnce(
    async (options) => {
      options.onSourceResult(sites[0], [video('offline')]);
      return [video('offline')];
    },
  );
  const events = await readEvents(
    await streamGET(request('?q=test&retry=offline,unknown-key')),
  );
  expect(peekCachedSearchAggregate).not.toHaveBeenCalled();
  expect(runSearchAggregation).toHaveBeenCalledWith(
    expect.objectContaining({ apiSites: [sites[0]], retryFailed: true }),
  );
  expect(events[0]).toMatchObject({ type: 'start', totalSources: 1 });
  expect(setCachedSearchAggregate).not.toHaveBeenCalled();
  expect(mergeRetriedSearchAggregate).toHaveBeenCalledWith(
    expect.objectContaining({
      apiSites: [sites[1], sites[2], sites[3], sites[0]],
    }),
    new Set(['offline']),
    { results: [video('offline')], failedSources: [] },
  );
});
