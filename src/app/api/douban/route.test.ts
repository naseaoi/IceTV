import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { fetchDoubanData } from '@/lib/douban';
import { recordServerProxyFailure } from '@/lib/server-proxy-guard';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

import { doubanRouteCache } from './cache';

installStreamPolyfills();

jest.mock('@/lib/config', () => ({
  getCacheTime: jest.fn().mockResolvedValue(300),
}));

jest.mock('@/lib/douban', () => ({
  fetchDoubanData: jest.fn(),
}));

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: jest.fn(),
  fetchPrivateUpstream: jest.fn(),
}));

jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: jest.fn().mockResolvedValue(null),
  recordServerProxyFailure: jest.fn(),
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe('douban route input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects NaN page size values', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/douban?type=movie&tag=热门&pageSize=NaN',
      ),
    );

    await expect(response.json()).resolves.toEqual({
      error: 'pageSize 必须在 1-100 之间',
    });
    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('encodes tag values before requesting douban', async () => {
    (fetchDoubanData as jest.Mock).mockResolvedValue({ subjects: [] });

    const response = await GET(
      createRequest(
        'http://localhost/api/douban?type=movie&tag=%E7%A7%91%E5%B9%BB%20%26%20%E6%82%AC%E7%96%91&pageSize=16&pageStart=0',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(response.headers.has('CDN-Cache-Control')).toBe(false);
    expect(response.headers.has('Vercel-CDN-Cache-Control')).toBe(false);
    expect(response.headers.has('Netlify-Vary')).toBe(false);
    const target = new URL((fetchDoubanData as jest.Mock).mock.calls.at(-1)[0]);
    expect(target.searchParams.get('tag')).toBe('科幻 & 悬疑');
    expect(target.searchParams.get('sort')).toBe('recommend');
  });
});

describe('douban Top250 HTML validation', () => {
  const fetchMock = jest.mocked(fetchUpstream);
  const movie = {
    id: '1292052',
    title: '肖申克的救赎',
    poster:
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/test.jpg',
    rate: '9.7',
    year: '',
  };
  const normalHtml = `<html><ol class="grid_view">
    <li><div class="item"><a href="https://movie.douban.com/subject/1292052/">
      <img alt="肖申克的救赎" src="http://img1.doubanio.com/view/photo/s_ratio_poster/public/test.jpg">
      </a><span class="rating_num" property="v:average">9.7</span>
    </div></li>
  </ol></html>`;
  const challengeHtml =
    '<html><title>安全验证</title><form>请输入验证码</form></html>';

  function target(pageStart = 0) {
    return `https://movie.douban.com/top250?start=${pageStart}&filter=`;
  }

  function request(pageStart = 0) {
    return createRequest(
      `http://localhost/api/douban?type=movie&tag=top250&pageStart=${pageStart}`,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    doubanRouteCache.clear();
    fetchMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    doubanRouteCache.clear();
  });

  it.each([0, 250])(
    'rejects HTTP 200 challenge pages at start=%s without caching them',
    async (pageStart) => {
      fetchMock.mockImplementation(async () => new Response(challengeHtml));

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await GET(request(pageStart));
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error: '获取豆瓣 Top250 数据失败',
        });
        expect(doubanRouteCache.peek(target(pageStart))).toBeNull();
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(recordServerProxyFailure).toHaveBeenCalledWith(
        'douban-data',
        expect.any(Error),
      );
    },
  );

  it('parses normal pages and reuses the cached result', async () => {
    fetchMock.mockResolvedValueOnce(new Response(normalHtml));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await GET(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        code: 200,
        message: '获取成功',
        list: [movie],
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(target(), expect.any(Object));
    expect(doubanRouteCache.peek(target())?.value).toMatchObject({
      list: [movie],
    });
  });

  it('rejects an unparseable list within the Top250 range', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<ol class="grid_view"><li>unexpected markup</li></ol>'),
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(doubanRouteCache.peek(target())).toBeNull();
  });

  it.each([250, 275])(
    'accepts an empty list container for out-of-range start=%s',
    async (pageStart) => {
      fetchMock.mockResolvedValueOnce(
        new Response('<html><ol class="grid_view"></ol></html>'),
      );

      const response = await GET(request(pageStart));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        code: 200,
        message: '获取成功',
        list: [],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        target(pageStart),
        expect.any(Object),
      );
      expect(doubanRouteCache.peek(target(pageStart))?.value).toMatchObject({
        list: [],
      });
    },
  );

  it('keeps stale results when background refresh receives a challenge page', async () => {
    const cached = { code: 200, message: '获取成功', list: [movie] };
    doubanRouteCache.hydrate(
      target(),
      cached,
      Date.now() - 1,
      Date.now() + 60_000,
    );
    fetchMock.mockResolvedValueOnce(new Response(challengeHtml));

    const response = await GET(request());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(cached);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(doubanRouteCache.stats().inflight).toBe(0);
    expect(doubanRouteCache.peek(target())).toEqual({
      value: cached,
      fresh: false,
    });
  });
});
