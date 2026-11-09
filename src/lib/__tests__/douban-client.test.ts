import { getDoubanCategories } from '../douban.client';
import { writeDoubanProxyType } from '../douban-source';

let signedIn = true;
jest.mock('../auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => (signedIn ? { username: 'alice' } : null),
}));

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('getDoubanCategories via server', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let page = 0;

  // 每个用例用不同分页，避开模块内的请求缓存
  function params() {
    page += 1;
    return {
      kind: 'movie' as const,
      category: '热门',
      type: '全部',
      pageStart: page * 25,
    };
  }

  beforeEach(() => {
    writeDoubanProxyType('server');
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns successful server results', async () => {
    fetchMock.mockResolvedValue(
      response({ code: 200, message: 'ok', list: [] }),
    );

    await expect(getDoubanCategories(params())).resolves.toMatchObject({
      code: 200,
      list: [],
    });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^\/api\/douban\/categories\?/,
    );
  });

  it.each([
    ['an error status', response({ error: '获取豆瓣数据失败' }, 500)],
    ['a malformed body', response({ error: 'x' })],
  ])('rejects %s and retries on the next request', async (_, failure) => {
    const request = params();
    fetchMock
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(response({ code: 200, message: 'ok', list: [] }));

    await expect(getDoubanCategories(request)).rejects.toThrow();
    await expect(getDoubanCategories(request)).resolves.toMatchObject({
      code: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getDoubanCategories in auto mode', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let page = 1000;

  function params() {
    page += 1;
    return {
      kind: 'movie' as const,
      category: '热门',
      type: '全部',
      pageStart: page * 25,
    };
  }

  function routeOf(url: string) {
    if (url.startsWith('https://ciao-cors.is-an.org/')) return 'zwei';
    if (url.startsWith('https://m.douban.cmliussss.net/')) return 'tencent';
    if (url.startsWith('/api/douban/')) return 'server';
    return url;
  }

  function requestedRoutes() {
    return fetchMock.mock.calls.map(([url]) => routeOf(String(url)));
  }

  const upstream = response({ items: [] });
  const server = response({ code: 200, message: 'ok', list: [] });

  beforeEach(() => {
    signedIn = true;
    writeDoubanProxyType('auto');
    window.sessionStorage.clear();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses Zwei first and stops there when it works', async () => {
    fetchMock.mockResolvedValue(upstream);

    await getDoubanCategories(params());

    expect(requestedRoutes()).toEqual(['zwei']);
  });

  it('falls back in order and remembers the working route', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response({ error: 'x' }, 502))
      .mockResolvedValueOnce(server)
      .mockResolvedValueOnce(server);

    await getDoubanCategories(params());
    await getDoubanCategories(params());

    expect(requestedRoutes()).toEqual(['zwei', 'tencent', 'server', 'server']);
  });

  it('never asks the server for guests', async () => {
    signedIn = false;
    fetchMock.mockRejectedValue(new TypeError('network'));

    await expect(getDoubanCategories(params())).rejects.toThrow();

    expect(requestedRoutes()).toEqual(['zwei', 'tencent']);
  });

  it('treats an empty list as a valid answer', async () => {
    fetchMock.mockResolvedValue(response({ items: [] }));

    await expect(getDoubanCategories(params())).resolves.toMatchObject({
      list: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
