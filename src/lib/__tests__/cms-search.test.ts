/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { validateSourceSearch } from '@/features/admin/lib/source-search-validation.server';
import { buildCmsSearchUrl } from '@/lib/cms-search.server';
import { probeSourceSearch, searchFromApi } from '@/lib/downstream';
import {
  clearSearchCachesForTests,
  getCachedSearchPage,
  peekCachedSearchPage,
} from '@/lib/search-cache';
import { SearchSourceUnavailableError } from '@/lib/search-source-error';
import { simplifySearchText } from '@/lib/search-text';
import { getSourceCacheKey } from '@/lib/source-cache-key';
import { recordSourceSearchOutcome } from '@/lib/source-health.server';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} } },
  getConfigForRead: jest.fn().mockResolvedValue({ SiteConfig: {} }),
}));
jest.mock('@/lib/source-health.server', () => ({
  recordSourceSearchOutcome: jest.fn(),
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (url: string, init: RequestInit) => fetch(url, init),
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
}));

installStreamPolyfills();
const originalFetch = global.fetch;
const site = {
  key: 'cms',
  name: 'CMS',
  api: 'https://example.com/api?token=demo',
};
const item = {
  vod_id: 1,
  vod_name: '龙珠',
  vod_pic: '',
  vod_play_url: '1$https://example.com/1.m3u8',
};
function response(data: unknown) {
  return new Response(JSON.stringify(data));
}

beforeEach(() => {
  clearSearchCachesForTests();
  jest.clearAllMocks();
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  clearSearchCachesForTests();
  jest.restoreAllMocks();
});

it('检测、第一页与健康探测使用一致的 URL，分页保留源参数与关键词编码', async () => {
  const query = "Movie A+B!'()*";
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async () =>
    response({
      list: [{ ...item, vod_name: query }],
      pagecount: 2,
    }),
  );
  await validateSourceSearch(site, query, new AbortController().signal);
  await searchFromApi(site, query, { maxSearchPages: 2 });
  await probeSourceSearch(site, query);
  const firstUrl = `https://example.com/api?token=demo&ac=videolist&wd=${encodeURIComponent(query)}`;
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    firstUrl,
    firstUrl,
    `${firstUrl}&pg=2`,
    firstUrl,
  ]);
  const overridden = new URL(
    buildCmsSearchUrl(`${site.api}&pg=9&wd=old&ac=list`, query),
  );
  expect(Object.fromEntries(overridden.searchParams)).toEqual({
    token: 'demo',
    ac: 'videolist',
    wd: query,
  });
});

it.each([
  { code: 1002, list: [] },
  { success: false, list: [item] },
  { list: null },
  { list: [null, { vod_name: '龙珠' }, { vod_id: 2, vod_name: 12 }] },
])('无效载荷写短期失败页缓存且保持 error 健康样本：%j', async (data) => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async () => response(data));
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const cacheKey = getSourceCacheKey(site);
  await expect(
    searchFromApi(site, '龙珠', { reportFailure: true }),
  ).rejects.toBeInstanceOf(SearchSourceUnavailableError);
  expect(getCachedSearchPage(cacheKey, '龙珠', 1)?.status).toBe('invalid');
  await expect(searchFromApi(site, '龙珠')).resolves.toEqual([]);
  await expect(
    searchFromApi(site, '龙珠', { reportFailure: true }),
  ).rejects.toBeInstanceOf(SearchSourceUnavailableError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
  expect(recordSourceSearchOutcome).toHaveBeenCalledWith(
    'cms',
    'error',
    expect.any(Number),
  );
  clock.mockReturnValue(now + 60_001);
  expect(getCachedSearchPage(cacheKey, '龙珠', 1)).toBeNull();
  expect(peekCachedSearchPage(cacheKey, '龙珠', 1)?.fresh).toBe(false);
  clock.mockReturnValue(now + 120_001);
  expect(peekCachedSearchPage(cacheKey, '龙珠', 1)).toBeNull();
  fetchMock.mockImplementation(async () => response({ list: [item] }));
  expect(await searchFromApi(site, '龙珠')).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('混合有效和脏条目时只保留有效条目，检测与搜索均成功', async () => {
  (global.fetch as jest.Mock).mockImplementation(async () =>
    response({
      code: '200',
      list: [
        null,
        [],
        42,
        { vod_name: '龙珠' },
        { ...item, vod_id: null },
        item,
      ],
    }),
  );
  expect(
    await validateSourceSearch(site, '龙珠', new AbortController().signal),
  ).toBe('valid');
  expect(await searchFromApi(site, '龙珠')).toEqual([
    expect.objectContaining({ id: '1', title: '龙珠' }),
  ]);
  expect(recordSourceSearchOutcome).toHaveBeenCalledWith(
    'cms',
    'ok',
    expect.any(Number),
  );
});

it('原词按页数搜索，补查最多第一页，补查结果使用独立缓存', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async (url: string) =>
    response({
      list:
        new URL(url).searchParams.get('wd') === '龙珠'
          ? [{ ...item, vod_name: '龙珠' }]
          : [],
      pagecount: 5,
    }),
  );
  const results = await searchFromApi(site, '龍珠', { maxSearchPages: 3 });
  expect(results.map((result) => result.title)).toEqual(['龙珠']);
  expect(
    fetchMock.mock.calls.map(([url]) => {
      const params = new URL(url).searchParams;
      return [params.get('wd'), params.get('pg')];
    }),
  ).toEqual([
    ['龍珠', null],
    ['龍珠', '2'],
    ['龍珠', '3'],
    ['龙珠', null],
  ]);
  expect(getCachedSearchPage(getSourceCacheKey(site), '龍珠', 1)?.data).toEqual(
    [],
  );
  expect(
    getCachedSearchPage(getSourceCacheKey(site), '龙珠', 1)?.data,
  ).toHaveLength(1);
  expect(await searchFromApi(site, '龍珠', { maxSearchPages: 3 })).toEqual(
    results,
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('默认子串命中保留龍珠超，精确判定继续补查简体龙珠', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async (url: string) =>
    response({
      list: [
        {
          ...item,
          vod_name:
            new URL(url).searchParams.get('wd') === '龍珠' ? '龍珠超' : '龙珠',
        },
      ],
    }),
  );
  expect((await searchFromApi(site, '龍珠'))[0].title).toBe('龍珠超');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    (
      await searchFromApi(site, '龍珠', {
        isMatch: (result) => simplifySearchText(result.title) === '龙珠',
      })
    )[0].title,
  ).toBe('龙珠');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
