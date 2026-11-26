/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { clearSearchSourceFailureCooldownsForTests } from '@/lib/search-aggregate';
import {
  clearSearchCachesForTests,
  makeSearchAggregateCacheKey,
  peekCachedSearchAggregate,
} from '@/lib/search-cache';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import type { SearchResult } from '@/lib/types';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn().mockResolvedValue({ username: 'demo' }),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/downstream', () => ({ searchFromApi: jest.fn() }));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('@/lib/shared-server-cache', () => {
  const actual = jest.requireActual('@/lib/shared-server-cache');
  return {
    ...actual,
    createSharedServerCache: (options: Record<string, unknown>) =>
      actual.createSharedServerCache({ ...options, enabled: true }),
  };
});
installStreamPolyfills();
const sites = ['a', 'b'].map((key) => ({
  key,
  name: key,
  api: `https://${key}.example`,
}));
const pending = new Map<
  string,
  { finish: (results: SearchResult[]) => void; signal: AbortSignal }[]
>();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const request = (signal = new AbortController().signal) =>
  ({
    url: 'http://localhost/api/search/ws?q=test',
    signal,
  }) as NextRequest;
const video = (source: string): SearchResult => ({
  source,
  source_name: source,
  id: source,
  title: 'test',
  year: '2026',
  episodes: ['https://example.com/video.m3u8'],
  episodes_titles: ['1'],
  poster: '',
});
const events = async (response: Response) =>
  (await response.text())
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.slice(6)));

beforeEach(() => {
  jest.clearAllMocks();
  clearSearchCachesForTests();
  clearSearchSourceFailureCooldownsForTests();
  pending.clear();
  (getAvailableApiSites as jest.Mock).mockResolvedValue(sites);
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { DisableYellowFilter: true },
  });
  (searchFromApi as jest.Mock).mockImplementation(
    (site, _query, options) =>
      new Promise<SearchResult[]>((finish) => {
        const list = pending.get(site.key) ?? [];
        list.push({ finish, signal: options.signal });
        pending.set(site.key, list);
        options.signal.addEventListener('abort', () => finish([]), {
          once: true,
        });
      }),
  );
});
afterEach(() => {
  clearSearchCachesForTests();
});

it('同键并发共享各源任务，后到者回放已完成源并收到后续结果', async () => {
  const first = await GET(request());
  pending.get('a')![0].finish([video('a')]);
  await tick();
  const second = await GET(request());
  expect(searchFromApi).toHaveBeenCalledTimes(2);
  const firstEvents = events(first);
  const secondEvents = events(second);
  pending.get('b')![0].finish([video('b')]);
  const [left, right] = await Promise.all([firstEvents, secondEvents]);
  expect(left).toEqual(right);
  expect(
    left
      .filter((event) => event.type === 'source_result')
      .map((event) => event.source),
  ).toEqual(['a', 'b']);
  expect(left.at(-1)).toMatchObject({
    type: 'complete',
    totalResults: 2,
    completedSources: 2,
  });
  expect(
    peekCachedSearchAggregate({
      query: 'test',
      apiSites: sites,
      maxSearchPages: 5,
      disableYellowFilter: true,
    })?.entry.results,
  ).toHaveLength(2);
  const cached = await events(await GET(request()));
  expect(
    cached.find((event) => event.source === 'aggregate-cache'),
  ).toBeDefined();
  expect(searchFromApi).toHaveBeenCalledTimes(2);
  const otherInstance = createSharedServerCache({
    name: 'search-aggregates-v3',
    freshMs: 120_000,
  });
  const loader = jest.fn();
  const shared = await otherInstance.getOrLoad(
    makeSearchAggregateCacheKey({
      query: 'test',
      apiSites: sites,
      maxSearchPages: 5,
      disableYellowFilter: true,
    }),
    loader,
  );
  expect(shared).toMatchObject({ results: [video('a'), video('b')] });
  expect(loader).not.toHaveBeenCalled();
});

it.each(['sources', 'filter'])(
  '不同权限结果维度 %s 保持独立',
  async (dimension) => {
    const first = await GET(request());
    if (dimension === 'sources')
      (getAvailableApiSites as jest.Mock).mockResolvedValue([sites[0]]);
    else
      (getConfigForRead as jest.Mock).mockResolvedValue({
        SiteConfig: { DisableYellowFilter: false },
      });
    const second = await GET(request());
    expect(pending.get('a')).toHaveLength(2);
    pending.forEach((loads, key) =>
      loads.forEach((load) => load.finish([video(key)])),
    );
    const [left, right] = await Promise.all([events(first), events(second)]);
    expect(left.at(-1).totalResults).toBe(2);
    expect(right.at(-1).totalResults).toBe(dimension === 'sources' ? 1 : 2);
  },
);

it('先到者断开后，后到者继续完成', async () => {
  const abort = new AbortController();
  const first = await GET(request(abort.signal));
  const second = await GET(request());
  abort.abort();
  expect(pending.get('a')![0].signal.aborted).toBe(false);
  pending.forEach((loads, key) => loads[0].finish([video(key)]));
  expect((await events(second)).at(-1)).toMatchObject({
    type: 'complete',
    totalResults: 2,
  });
  await first.text();
});

it('全部取消后中止聚合，立即允许同键新任务，旧任务不写部分缓存', async () => {
  const first = await GET(request());
  const second = await GET(request());
  await first.body!.cancel();
  expect(pending.get('a')![0].signal.aborted).toBe(false);
  await second.body!.cancel();
  expect(pending.get('a')![0].signal.aborted).toBe(true);
  const replacement = await GET(request());
  expect(pending.get('a')).toHaveLength(2);
  pending.forEach((loads, key) => loads[1].finish([video(key)]));
  expect((await events(replacement)).at(-1)).toMatchObject({
    type: 'complete',
    totalResults: 2,
  });
});

it('全部取消停止尚未启动的源调度', async () => {
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { DisableYellowFilter: true, UpstreamSearchConcurrency: 1 },
  });
  const abort = new AbortController();
  const response = await GET(request(abort.signal));
  expect(searchFromApi).toHaveBeenCalledTimes(1);
  abort.abort();
  await response.text();
  await tick();
  expect(searchFromApi).toHaveBeenCalledTimes(1);
  expect(
    peekCachedSearchAggregate({
      query: 'test',
      apiSites: sites,
      maxSearchPages: 5,
      disableYellowFilter: true,
    }),
  ).toBeNull();
});

it('不同键任务达到上限返回繁忙，取消后清理任务', async () => {
  const responses: Response[] = [];
  for (let i = 0; i < 64; i++) {
    responses.push(
      await GET({
        ...request(),
        url: `http://localhost/api/search/ws?q=key-${i}`,
      } as NextRequest),
    );
  }
  expect((await GET(request())).status).toBe(503);
  await Promise.all(responses.map((response) => response.body!.cancel()));
  await tick();
  const next = await GET(request());
  expect(next.status).toBe(200);
  await next.body!.cancel();
  await tick();
});

it('订阅者达到上限返回繁忙，取消后恢复准入', async () => {
  const responses: Response[] = [];
  for (let i = 0; i < 384; i++) responses.push(await GET(request()));
  expect((await GET(request())).status).toBe(503);
  expect(searchFromApi).toHaveBeenCalledTimes(2);
  await Promise.all(responses.map((response) => response.body!.cancel()));
  const next = await GET(request());
  expect(next.status).toBe(200);
  await next.body!.cancel();
  await tick();
});
