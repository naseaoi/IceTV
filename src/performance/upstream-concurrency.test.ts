/** @jest-environment node */

import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';
import { upstreamResourcePolicy } from '@/lib/upstream-resource-policy';
import { createSyntheticUpstream } from '@/performance/synthetic-upstream';

jest.unmock('@/lib/upstream-resource-guard.server');
jest.mock('@/lib/db', () => ({
  db: Object.fromEntries(
    [
      'getSharedCache',
      'acquireSharedCacheLease',
      'setSharedCache',
      'releaseSharedCacheLease',
      'renewSharedCacheLease',
      'pruneSharedCache',
    ]
      .map((method) => [
        method,
        (...args: unknown[]) =>
          (
            mockStorage[method as keyof LocalSqliteStorage] as (
              ...values: unknown[]
            ) => unknown
          ).apply(mockStorage, args),
      ])
      .concat([
        [
          'getSharedResourceStore',
          () => Promise.resolve(mockStorage.resources),
        ],
      ]),
  ),
}));
jest.mock('@/lib/shared-server-cache', () => ({
  createSharedServerCache: (options: object) => {
    const cache = jest
      .requireActual('@/lib/shared-server-cache')
      .createSharedServerCache({ ...options, enabled: true });
    mockCaches.push(cache);
    return cache;
  },
}));
jest.mock('@/lib/config', () => ({
  API_CONFIG: jest.requireActual('@/lib/config').API_CONFIG,
  getConfigForRead: async () => ({ SiteConfig: {} }),
  getPublicConfig: async () => ({ DoubanImageProxyType: 'direct' }),
}));
jest.mock('@/features/bangumi/lib/bangumi', () => ({
  getCachedBangumiCalendarData: () => [],
}));
jest.mock('@/lib/douban-image-url.server', () => ({
  readServerDoubanImageProxyType: async () => 'direct',
}));
jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: (url: string, init?: RequestInit) => mockFetch(url, init),
  fetchPrivateUpstream: (url: string, init?: RequestInit) =>
    mockFetch(url, init),
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (
    url: string,
    init: RequestInit & { resourceContext?: object },
  ) => mockFetch(url, init),
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
}));
jest.mock('@/features/play/lib/ad-segment-detector', () => ({
  filterM3U8AdsForSource: async (content: string) => content,
}));
jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabled: async () => true,
}));
jest.mock('@/app/api/proxy/utils', () => ({
  getProxySourceKey: () => null,
  resolveProxyUserAgent: async () => 'Synthetic',
}));
jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: async (request: NextRequest) => ({
    authorized: true,
    via: 'session',
    username: request.headers.get('x-synthetic-user'),
  }),
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: () => undefined,
  fetchResponseThroughProxy: jest.fn(),
  fetchStreamThroughProxy: jest.fn(),
}));

let mockStorage: LocalSqliteStorage;
let mockUpstream: ReturnType<typeof createSyntheticUpstream>;
const mockCaches: Array<{
  clear(): void;
  stats(): { hits: number; misses: number; sharedHits: number };
}> = [];
function mockFetch(
  url: string,
  init: RequestInit & { resourceContext?: object } = {},
) {
  return withUpstreamResponse(
    url,
    (signal) => mockUpstream.fetch(url, signal),
    {
      ...init.resourceContext,
      signal: init.signal,
      store: mockStorage.resources,
    },
  );
}

installStreamPolyfills();
const { getHomeInitialData } =
  require('@/features/home/lib/home.server') as typeof import('@/features/home/lib/home.server');
const { getCachedDetail } =
  require('@/lib/detail-cache') as typeof import('@/lib/detail-cache');
const { searchFirstPageFromApi } =
  require('@/lib/downstream') as typeof import('@/lib/downstream');
const { clearSearchCachesForTests, getSearchCacheStats } =
  require('@/lib/search-cache') as typeof import('@/lib/search-cache');
const { loadM3U8Data } =
  require('@/app/api/proxy/m3u8/service') as typeof import('@/app/api/proxy/m3u8/service');
const { loadResizedCoverImage } =
  require('@/lib/cover-image-resize-cache.server') as typeof import('@/lib/cover-image-resize-cache.server');
const { GET: getSegment } =
  require('@/app/api/proxy/segment/route') as typeof import('@/app/api/proxy/segment/route');

function cacheStats() {
  const pages = getSearchCacheStats();
  return mockCaches.reduce(
    (total, cache) => {
      const stats = cache.stats();
      return {
        hits: total.hits + stats.hits + stats.sharedHits,
        misses: total.misses + stats.misses,
      };
    },
    {
      hits: pages.pages.hits + pages.emptyPages.hits,
      misses: pages.pages.misses + pages.emptyPages.misses,
    },
  );
}

const runSuite =
  process.env.RUN_UPSTREAM_CONCURRENCY_CHECK === '1' ? describe : describe.skip;
runSuite('synthetic upstream concurrency', () => {
  jest.setTimeout(120_000);

  it('measures real service caches and segment admission at 1/10/30/50 clients', async () => {
    const reports: object[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw new Error('External network disabled during synthetic check');
    });
    const source = {
      key: 'synthetic',
      name: 'Synthetic',
      api: 'https://metadata.example/api',
    };
    const scenarios: Array<{
      name: string;
      demand: number;
      call: (user: number) => Promise<Response>;
    }> = [
      {
        name: 'home',
        demand: 3,
        call: async () => {
          const data = await getHomeInitialData();
          expect(data.hotMovies).toHaveLength(20);
          expect(data.hotTvShows).toHaveLength(20);
          expect(data.hotVarietyShows).toHaveLength(20);
          return Response.json(data);
        },
      },
      {
        name: 'detail',
        demand: 1,
        call: async () => Response.json(await getCachedDetail(source, '1')),
      },
      {
        name: 'search',
        demand: 1,
        call: async () =>
          Response.json(await searchFirstPageFromApi(source, 'Synthetic')),
      },
      {
        name: 'm3u8',
        demand: 1,
        call: async () =>
          new Response(
            (
              await loadM3U8Data(
                'https://media.example/playlist.m3u8',
                'Synthetic',
                'synthetic',
                false,
                false,
                {
                  startedAt: Date.now(),
                  proxyMode: 'server',
                  userAction: null,
                  userInitiated: false,
                },
              )
            ).content,
          ),
      },
      {
        name: 'cover',
        demand: 1,
        call: async () =>
          new Response(
            await loadResizedCoverImage(
              'https://cover.example/resized.webp',
              { width: 300, quality: 75 },
              async () =>
                (
                  await mockFetch('https://cover.example/resized.webp')
                ).arrayBuffer(),
            ),
          ),
      },
      {
        name: 'segment',
        demand: 1,
        call: (user) =>
          getSegment({
            url: 'http://test/api/proxy/segment?url=https%3A%2F%2Fmedia.example%2Fsegment.ts',
            headers: new Headers({ 'x-synthetic-user': `user-${user}` }),
            signal: new AbortController().signal,
          } as NextRequest),
      },
    ];
    try {
      for (const users of [1, 10, 30, 50]) {
        for (const scenario of scenarios) {
          mockStorage = new LocalSqliteStorage(':memory:');
          for (const cache of mockCaches) cache.clear();
          clearSearchCachesForTests();
          try {
            for (const phase of ['cold', 'warm']) {
              mockUpstream = createSyntheticUpstream();
              const before = cacheStats();
              const startedAt = performance.now();
              const results = await Promise.all(
                Array.from({ length: users }, async (_, user) => {
                  try {
                    const response = await scenario.call(user);
                    return {
                      status: response.status,
                      bytes: (await response.arrayBuffer()).byteLength,
                    };
                  } catch (error) {
                    return {
                      status: (error as { status?: number }).status ?? 500,
                      bytes: 0,
                    };
                  }
                }),
              );
              const seconds = (performance.now() - startedAt) / 1000;
              const statuses = Object.fromEntries(
                [200, 429, 503, 500].map((status) => [
                  status,
                  results.filter((result) => result.status === status).length,
                ]),
              );
              const after = cacheStats();
              const hits = after.hits - before.hits;
              const misses = after.misses - before.misses;
              const responseBytes = results.reduce(
                (total, result) => total + result.bytes,
                0,
              );
              const hosts = Object.fromEntries(
                [...mockUpstream.hosts].map(([host, metrics]) => [
                  host,
                  {
                    ...metrics,
                    qps: metrics.requests / seconds,
                    failureRate: metrics.failures / metrics.requests,
                  },
                ]),
              );
              const upstreamRequests = [...mockUpstream.hosts.values()].reduce(
                (total, metrics) => total + metrics.requests,
                0,
              );
              reports.push({
                scenario: scenario.name,
                users,
                phase,
                elapsedMs: seconds * 1000,
                applicationQps: users / seconds,
                statuses,
                applicationFailureRate: (users - statuses[200]) / users,
                responseBytes,
                responseBytesPerSecond: responseBytes / seconds,
                cacheHits: hits,
                cacheMisses: misses,
                cacheHitRate: hits + misses ? hits / (hits + misses) : null,
                coalescedOrCachedRate:
                  scenario.name === 'segment'
                    ? null
                    : 1 - upstreamRequests / (users * scenario.demand),
                upstream: hosts,
              });
              expect(statuses[500]).toBe(0);
              expect(
                results.every((result) =>
                  [200, 429, 503].includes(result.status),
                ),
              ).toBe(true);
              for (const metrics of mockUpstream.hosts.values())
                expect(metrics.active).toBe(0);
              if (scenario.name === 'segment') {
                expect(statuses[200]).toBeGreaterThan(0);
                expect(
                  [...mockUpstream.hosts.values()][0].peakConnections,
                ).toBeLessThanOrEqual(
                  upstreamResourcePolicy('vod').hostConcurrency,
                );
              } else {
                expect(statuses[200]).toBe(users);
                expect(upstreamRequests).toBe(
                  phase === 'cold' ? scenario.demand : 0,
                );
              }
            }
          } finally {
            (mockStorage as unknown as { db: Database.Database }).db.close();
          }
        }
      }
    } finally {
      global.fetch = originalFetch;
    }
    mkdirSync('tmp', { recursive: true });
    writeFileSync(
      'tmp/upstream-concurrency-report.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          node: process.version,
          scope:
            'Synthetic service-level load, real SQLite/cache/guard and segment handler; no external network, Next HTTP rendering, authentication, image encoding, CDN or real origin load.',
          policies: {
            metadata: upstreamResourcePolicy('metadata'),
            media: upstreamResourcePolicy('vod'),
          },
          reports,
        },
        null,
        2,
      ),
    );
    console.table(
      reports.map((report) => {
        const row = report as {
          scenario: string;
          users: number;
          phase: string;
          statuses: object;
          elapsedMs: number;
        };
        return {
          scenario: row.scenario,
          users: row.users,
          phase: row.phase,
          milliseconds: Math.round(row.elapsedMs),
          statuses: JSON.stringify(row.statuses),
        };
      }),
    );
  });
});
