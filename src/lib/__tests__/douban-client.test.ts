import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '../douban.client';
import {
  readDoubanFallbackRoute,
  rememberDoubanFallbackRoute,
} from '../douban-route-memory';
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
    signedIn = true;
    jest.useRealTimers();
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

  it('rejects after fifteen seconds in explicit server mode without fallback', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason));
      });
    });

    const pending = expect(getDoubanCategories(params())).rejects.toThrow(
      'timeout',
    );
    jest.advanceTimersByTime(14_999);
    expect(signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);

    await pending;
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
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
    if (/^https:\/\/(m|movie)\.douban\.cmliussss\.net\//.test(url))
      return 'tencent';
    if (/^\/api\/douban[/?]/.test(url)) return 'server';
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
    signedIn = true;
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('uses the server first for signed-in users', async () => {
    fetchMock.mockResolvedValue(server);

    await getDoubanCategories(params());

    expect(requestedRoutes()).toEqual(['server']);
    expect(readDoubanFallbackRoute('data')).toBeNull();
  });

  it('falls back in order and remembers the working route', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response({ error: 'x' }, 502))
      .mockResolvedValueOnce(upstream)
      .mockResolvedValueOnce(upstream);

    await getDoubanCategories(params());
    await getDoubanCategories(params());

    expect(requestedRoutes()).toEqual(['server', 'tencent', 'zwei', 'zwei']);
    expect(readDoubanFallbackRoute('data')).toBe('cors-proxy-zwei');
  });

  it.each([
    ['HTTP 400', response({ error: 'bad request' }, 400)],
    ['HTTP 401', response({ error: 'unauthorized' }, 401)],
    ['HTTP 429', response({ error: 'rate limited' }, 429)],
    ['HTTP 503', response({ error: 'unavailable' }, 503)],
    ['a malformed body', response({ items: [] })],
    ['an invalid result code', response({ code: 500, list: [] })],
    ['invalid JSON', { ok: true, json: async () => JSON.parse('{') }],
  ])('falls back to Tencent after server returns %s', async (_, failure) => {
    fetchMock.mockResolvedValueOnce(failure).mockResolvedValueOnce(upstream);

    await expect(getDoubanCategories(params())).resolves.toMatchObject({
      code: 200,
      list: [],
    });

    expect(requestedRoutes()).toEqual(['server', 'tencent']);
    expect(readDoubanFallbackRoute('data')).toBe('cmliussss-cdn-tencent');
  });

  it('uses Tencent first for guests', async () => {
    signedIn = false;
    fetchMock.mockResolvedValue(upstream);

    await getDoubanCategories(params());

    expect(requestedRoutes()).toEqual(['tencent']);
    expect(readDoubanFallbackRoute('data')).toBeNull();
  });

  it('never asks the server for guests, even with an old server preference', async () => {
    signedIn = false;
    rememberDoubanFallbackRoute('data', 'server');
    fetchMock.mockRejectedValue(new TypeError('network'));

    await expect(getDoubanCategories(params())).rejects.toThrow();

    expect(requestedRoutes()).toEqual(['tencent', 'zwei']);
  });

  it.each([true, false])(
    'clears route memory when the default route recovers (signed in: %s)',
    async (authenticated) => {
      signedIn = authenticated;
      rememberDoubanFallbackRoute('data', 'cors-proxy-zwei');
      fetchMock
        .mockRejectedValueOnce(new TypeError('network'))
        .mockResolvedValueOnce(authenticated ? server : upstream);

      await getDoubanCategories(params());

      expect(requestedRoutes()).toEqual([
        'zwei',
        authenticated ? 'server' : 'tencent',
      ]);
      expect(readDoubanFallbackRoute('data')).toBeNull();
    },
  );

  it.each([true, false])(
    'does not renew a remembered winner and restores defaults after five minutes (signed in: %s)',
    async (authenticated) => {
      jest.useFakeTimers();
      signedIn = authenticated;
      const startedAt = Date.now();
      const fallback = authenticated
        ? 'cmliussss-cdn-tencent'
        : 'cors-proxy-zwei';
      fetchMock
        .mockRejectedValueOnce(new TypeError('network'))
        .mockResolvedValue(upstream);

      await getDoubanCategories(params());
      expect(readDoubanFallbackRoute('data')).toBe(fallback);
      jest.setSystemTime(startedAt + 4 * 60 * 1000);
      await getDoubanCategories(params());
      expect(
        readDoubanFallbackRoute('data', startedAt + 5 * 60 * 1000),
      ).toBeNull();

      jest.setSystemTime(startedAt + 5 * 60 * 1000);
      fetchMock.mockResolvedValueOnce(authenticated ? server : upstream);
      await getDoubanCategories(params());

      const first = authenticated ? 'server' : 'tencent';
      const winner = authenticated ? 'tencent' : 'zwei';
      expect(requestedRoutes()).toEqual([first, winner, winner, first]);
    },
  );

  it.each(['auto', 'server'] as const)(
    'accepts a server response just before fifteen seconds in %s mode',
    async (mode) => {
      jest.useFakeTimers();
      writeDoubanProxyType(mode);
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal?.reason));
          setTimeout(() => resolve(server), 14_999);
        });
      });

      const pending = getDoubanCategories(params());
      jest.advanceTimersByTime(14_999);

      await expect(pending).resolves.toMatchObject({ code: 200, list: [] });
      expect(signal?.aborted).toBe(false);
      expect(requestedRoutes()).toEqual(['server']);
      expect(readDoubanFallbackRoute('data')).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ['server', true, 15_000, 'reason'],
    ['server', true, 15_000, 'AbortError'],
    ['tencent', false, 10_000, 'reason'],
    ['tencent', false, 10_000, 'AbortError'],
  ] as const)(
    'falls back after %s (signed in: %s) reaches %s ms (%s rejection)',
    async (route, authenticated, timeoutMs, rejection) => {
      jest.useFakeTimers();
      signedIn = authenticated;
      let signal: AbortSignal | undefined;
      fetchMock
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          signal = init.signal as AbortSignal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(
                rejection === 'reason'
                  ? signal?.reason
                  : new DOMException('Aborted', 'AbortError'),
              );
            });
          });
        })
        .mockResolvedValueOnce(upstream);

      const pending = getDoubanCategories(params());
      jest.advanceTimersByTime(timeoutMs - 1);
      expect(signal?.aborted).toBe(false);
      expect(requestedRoutes()).toEqual([route]);
      jest.advanceTimersByTime(1);

      await expect(pending).resolves.toMatchObject({ code: 200, list: [] });
      expect(signal?.aborted).toBe(true);
      expect(requestedRoutes()).toEqual([
        route,
        authenticated ? 'tencent' : 'zwei',
      ]);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ['categories', () => getDoubanCategories(params())],
    [
      'list',
      () =>
        getDoubanList({
          tag: '热门',
          type: 'movie',
          pageStart: params().pageStart,
        }),
    ],
    [
      'recommends',
      () =>
        getDoubanRecommends({ kind: 'movie', pageStart: params().pageStart }),
    ],
  ] as const)(
    'preserves cancellation without fallback for %s',
    async (_, load) => {
      const abort = new DOMException('Aborted', 'AbortError');
      fetchMock.mockRejectedValue(abort);

      await expect(load()).rejects.toBe(abort);
      expect(requestedRoutes()).toEqual(['server']);

      signedIn = false;
      fetchMock.mockClear();
      rememberDoubanFallbackRoute('data', 'cmliussss-cdn-tencent');
      await expect(load()).rejects.toBe(abort);
      expect(requestedRoutes()).toEqual(['tencent']);
      expect(readDoubanFallbackRoute('data')).toBe('cmliussss-cdn-tencent');
    },
  );

  it('treats an empty list as a valid answer', async () => {
    fetchMock.mockResolvedValue(server);

    await expect(getDoubanCategories(params())).resolves.toMatchObject({
      list: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
