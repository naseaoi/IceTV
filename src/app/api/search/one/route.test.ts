/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { clearSearchCachesForTests } from '@/lib/search-cache';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(async () => ({ username: 'user' })),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} } },
  getConfigForRead: jest.fn(async () => ({
    SiteConfig: { DisableYellowFilter: true, SearchDownstreamMaxPage: 2 },
  })),
  getAvailableApiSites: jest.fn(async () => [
    { key: 'cms', name: 'CMS', api: 'https://example.com/api?token=demo' },
  ]),
}));
jest.mock('@/lib/source-health.server', () => ({
  recordSourceSearchOutcome: jest.fn(),
}));

installStreamPolyfills();
const { GET } = require('./route') as typeof import('./route');
const originalFetch = global.fetch;
beforeEach(() => {
  clearSearchCachesForTests();
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    const query = new URL(url).searchParams.get('wd');
    return new Response(
      JSON.stringify({
        pagecount: 2,
        list: [
          {
            vod_id: 1,
            vod_name: query === '龍珠' ? '龍珠超' : '龙珠',
            vod_play_url: '1$https://video.test/1.m3u8',
          },
        ],
      }),
    );
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  clearSearchCachesForTests();
});

it('精确命中触发简繁补查，补查只取第一页并保留原标题', async () => {
  const response = await GET({
    url: 'http://localhost/api/search/one?q=龍珠&resourceId=cms',
  } as NextRequest);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    results: [expect.objectContaining({ title: '龙珠', source: 'cms' })],
  });
  expect(
    (global.fetch as jest.Mock).mock.calls.map(([url]) => {
      const params = new URL(url).searchParams;
      return [params.get('wd'), params.get('pg'), params.get('token')];
    }),
  ).toEqual([
    ['龍珠', null, 'demo'],
    ['龍珠', '2', 'demo'],
    ['龙珠', null, 'demo'],
  ]);
});

it('补查仍只有子串匹配时返回未找到结果', async () => {
  (global.fetch as jest.Mock).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          list: [
            {
              vod_id: 1,
              vod_name: '龙珠超',
              vod_play_url: '1$https://video.test/1.m3u8',
            },
          ],
        }),
      ),
  );
  const response = await GET({
    url: 'http://localhost/api/search/one?q=龍珠&resourceId=cms',
  } as NextRequest);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ result: null, error: '未找到结果' });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
