/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import type { ApiSite } from '@/lib/config';
import {
  probeSourceSearch,
  searchFirstPageFromApi,
  searchFromApi,
} from '@/lib/downstream';
import { searchFromGirigiri } from '@/lib/downstream-sources/giri';
import { searchFromXgcartoon } from '@/lib/downstream-sources/xgcartoon';
import {
  dedupeSearchLoad,
  getCachedSearchPage,
  peekCachedSearchPage,
} from '@/lib/search-cache';
import { SearchSourceUnavailableError } from '@/lib/search-source-error';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { recordSourceSearchOutcome } from '@/lib/source-health.server';
import type { SearchResult } from '@/lib/types';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { headers: {}, path: '?wd=', pagePath: '?wd={query}&pg={page}' },
  },
  getConfigForRead: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { SearchRequestTimeoutSeconds: 8 } }),
}));
jest.mock('@/lib/downstream-sources/giri', () => ({
  ...jest.requireActual('@/lib/downstream-sources/giri'),
  searchFromGirigiri: jest.fn(),
}));
jest.mock('@/lib/downstream-sources/xgcartoon', () => ({
  ...jest.requireActual('@/lib/downstream-sources/xgcartoon'),
  searchFromXgcartoon: jest.fn(),
}));
jest.mock('@/lib/search-cache', () => ({
  loadSpecialSourceSearch: jest.fn(
    (_source: string, _query: string, loader: () => Promise<unknown>) =>
      loader(),
  ),
  getCachedSearchPage: jest.fn(),
  peekCachedSearchPage: jest.fn(),
  setCachedSearchPage: jest.fn(),
  dedupeSearchLoad: jest.fn(
    (
      _source: string,
      _query: string,
      _page: number,
      loader: () => Promise<unknown>,
    ) => loader(),
  ),
}));
jest.mock('@/lib/source-health.server', () => ({
  recordSourceSearchOutcome: jest.fn(),
}));
jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: jest.fn(),
  fetchPrivateUpstream: jest.fn(),
}));

installStreamPolyfills();

const site: ApiSite = { key: 'a', name: 'A', api: 'https://example.com/api' };
const fetchMock = fetchUpstream as jest.Mock;
const item = { vod_id: 1, vod_name: 'Movie', vod_pic: '', vod_play_url: '' };

beforeEach(() => {
  jest.clearAllMocks();
  (getCachedSearchPage as jest.Mock).mockReturnValue(null);
  (peekCachedSearchPage as jest.Mock).mockReturnValue(null);
});
afterEach(() => {
  jest.useRealTimers();
});

it.each([
  ['ok', [item]],
  ['empty', []],
])(
  'records %s from the raw upstream list, timed through JSON parsing',
  async (outcome, list) => {
    jest.useFakeTimers().setSystemTime(0);
    fetchMock.mockImplementation(async () => {
      jest.advanceTimersByTime(100);
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              jest.advanceTimersByTime(50);
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify({ list })),
              );
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
      );
    });
    await searchFromApi(site, 'movie');
    expect(recordSourceSearchOutcome).toHaveBeenCalledWith('a', outcome, 150);
    expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
  },
);

it('records non-2xx errors and cancels the response body', async () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({ ok: false, status: 503, body: { cancel } });
  await searchFromApi(site, 'movie');
  expect(recordSourceSearchOutcome).toHaveBeenCalledWith('a', 'error', 0);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each(['network', 'json', 'shape'])(
  'records %s failures',
  async (failure) => {
    fetchMock.mockImplementation(async () => {
      if (failure === 'network') throw new Error('network');
      return new Response(
        failure === 'json'
          ? 'invalid JSON'
          : JSON.stringify({ list: 'invalid' }),
      );
    });
    await searchFromApi(site, 'movie');
    expect(recordSourceSearchOutcome).toHaveBeenCalledWith(
      'a',
      'error',
      expect.any(Number),
    );
  },
);

it('records its own timeout, even if the parent is subsequently aborted', async () => {
  jest.useFakeTimers();
  const parent = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        markStarted();
        init.signal?.addEventListener('abort', () => {
          parent.abort();
          reject(init.signal?.reason);
        });
      }),
  );
  const result = probeSourceSearch(site, 'movie', parent.signal);
  await started;
  jest.advanceTimersByTime(8000);
  await result;
  expect(recordSourceSearchOutcome).toHaveBeenCalledWith('a', 'error', 0);
});

it('excludes parent cancellation during upstream loading', async () => {
  const parent = new AbortController();
  fetchMock.mockImplementation(async () => {
    parent.abort();
    throw new Error('cancelled');
  });
  await probeSourceSearch(site, 'movie', parent.signal);
  expect(recordSourceSearchOutcome).not.toHaveBeenCalled();
});

it('excludes already aborted requests and resource limits', async () => {
  const parent = new AbortController();
  parent.abort();
  await searchFromApi(site, 'movie', { signal: parent.signal });
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRejectedValue(new ResourceLimitError());
  await expect(searchFromApi(site, 'movie')).rejects.toBeInstanceOf(
    ResourceLimitError,
  );
  expect(recordSourceSearchOutcome).not.toHaveBeenCalled();
});

it('counts page one once while fetching subsequent pages', async () => {
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ list: [], pagecount: 2 })),
  );
  await searchFromApi(site, 'movie', { maxSearchPages: 2 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
});

it('excludes fresh cache hits and counts the actual stale background refresh', async () => {
  (getCachedSearchPage as jest.Mock).mockReturnValue({
    status: 'ok',
    data: [],
    pageCount: 1,
  });
  await searchFromApi(site, 'movie');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(recordSourceSearchOutcome).not.toHaveBeenCalled();
  (getCachedSearchPage as jest.Mock).mockReturnValue(null);
  (peekCachedSearchPage as jest.Mock).mockReturnValue({
    fresh: false,
    entry: { status: 'ok', data: [], pageCount: 1 },
  });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ list: [] })));
  await searchFromApi(site, 'movie');
  expect(dedupeSearchLoad).toHaveBeenCalledTimes(1);
  await (dedupeSearchLoad as jest.Mock).mock.results[0].value;
  expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
});

it.each([
  ['ok', [item]],
  ['empty', []],
  ['error', 'invalid'],
])(
  'probes page one without cache reads and records %s',
  async (outcome, list) => {
    (getCachedSearchPage as jest.Mock).mockReturnValue({
      status: 'ok',
      data: [],
      pageCount: 5,
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ list, pagecount: 5 })),
    );
    await expect(
      probeSourceSearch(site, 'space movie'),
    ).resolves.toBeUndefined();
    expect(getCachedSearchPage).not.toHaveBeenCalled();
    expect(peekCachedSearchPage).not.toHaveBeenCalled();
    expect(dedupeSearchLoad).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api?wd=space%20movie',
      expect.any(Object),
    );
    expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
    expect(recordSourceSearchOutcome).toHaveBeenCalledWith(
      'a',
      outcome,
      expect.any(Number),
    );
  },
);

it.each(['https://www.girigirilove.com', 'https://www.xgcartoon.com'])(
  'skips special source %s without collecting a sample',
  async (api) => {
    await probeSourceSearch({ ...site, api }, 'movie');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordSourceSearchOutcome).not.toHaveBeenCalled();
  },
);

it('isolates probe resource limits and excludes cancellation', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const parent = new AbortController();
    parent.abort();
    await probeSourceSearch(site, 'movie', parent.signal);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new ResourceLimitError());
    await expect(probeSourceSearch(site, 'movie')).resolves.toBeUndefined();
    expect(recordSourceSearchOutcome).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

it('records network failures during probing without throwing', async () => {
  fetchMock.mockRejectedValue(new Error('network'));
  await expect(probeSourceSearch(site, 'movie')).resolves.toBeUndefined();
  expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
  expect(recordSourceSearchOutcome).toHaveBeenCalledWith('a', 'error', 0);
});

it.each([
  ['全1集', 'ended'],
  ['更新至1集', 'ongoing'],
])('搜索映射作品状态 %s', async (vod_remarks, expected) => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        list: [
          {
            ...item,
            vod_remarks,
            vod_play_url: '第1集$https://example.com/1.m3u8',
          },
        ],
      }),
    ),
  );
  const results = await searchFromApi(site, 'movie');
  expect(results[0].series_status).toBe(expected);
});

function searchResult(id: string, source = 'a'): SearchResult {
  return {
    id,
    source,
    source_name: source,
    title: 'Movie',
    poster: '',
    year: '2026',
    episodes: ['https://example.com/1.m3u8'],
    episodes_titles: ['1'],
  };
}

it('deduplicates overlapping search pages in first-occurrence order', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    const ids = url.includes('pg=2') ? [2, 3] : [1, 1, 2];
    return new Response(
      JSON.stringify({
        list: ids.map((id, index) => ({
          ...item,
          vod_id: id,
          vod_name: `Movie ${id}-${index}`,
          vod_play_url: '1$https://example.com/1.m3u8',
        })),
        pagecount: 2,
      }),
    );
  });
  const results = await searchFromApi(site, 'movie', { maxSearchPages: 2 });
  expect(results.map((result) => result.id)).toEqual(['1', '2', '3']);
  expect(results.map((result) => result.title)).toEqual([
    'Movie 1-0',
    'Movie 2-2',
    'Movie 3-1',
  ]);
});

it('deduplicates the first search page without mutating cached results', async () => {
  const first = searchResult('1');
  const second = searchResult('2');
  const cached = [first, { ...first, title: 'duplicate' }, second];
  (getCachedSearchPage as jest.Mock).mockReturnValue({
    status: 'ok',
    data: cached,
    pageCount: 1,
  });
  const results = await searchFirstPageFromApi(site, 'movie');
  expect(results).toEqual([first, second]);
  expect(results[0]).toBe(first);
  expect(cached).toHaveLength(3);
});

it('preserves distinct source identities and the original unique array', async () => {
  const cached = [searchResult('1', 'a'), searchResult('1', 'b')];
  (getCachedSearchPage as jest.Mock).mockReturnValue({
    status: 'ok',
    data: cached,
    pageCount: 1,
  });
  expect(await searchFirstPageFromApi(site, 'movie')).toBe(cached);
});

it.each([
  ['giri', 'https://www.girigirilove.com', searchFromGirigiri],
  ['xgcartoon', 'https://www.xgcartoon.com', searchFromXgcartoon],
])(
  'deduplicates %s results at both search entry points',
  async (_name, api, search) => {
    const first = searchResult('1');
    const second = searchResult('2');
    const cached = [first, { ...first, title: 'duplicate' }, second];
    (search as jest.Mock).mockResolvedValue(cached);
    expect(await searchFromApi({ ...site, api }, 'movie')).toEqual([
      first,
      second,
    ]);
    expect(await searchFirstPageFromApi({ ...site, api }, 'movie')).toEqual([
      first,
      second,
    ]);
    expect(cached).toHaveLength(3);
  },
);

it('isolates the first search-page consumer cancellation while the shared loader fills cache', async () => {
  const actual =
    jest.requireActual<typeof import('@/lib/search-cache')>(
      '@/lib/search-cache',
    );
  actual.clearSearchCachesForTests();
  const dedupeMock = dedupeSearchLoad as jest.Mock;
  dedupeMock.mockImplementation(actual.dedupeSearchLoad);
  const first = new AbortController();
  let resolveResponse!: (response: Response) => void;
  let upstreamSignal!: AbortSignal;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    upstreamSignal = init.signal as AbortSignal;
    markStarted();
    return new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
  });
  try {
    const cancelled = searchFromApi(site, 'shared', { signal: first.signal });
    await started;
    const active = searchFromApi(site, 'shared');
    first.abort();
    await expect(cancelled).resolves.toEqual([]);
    expect(upstreamSignal.aborted).toBe(false);
    resolveResponse(
      new Response(
        JSON.stringify({
          list: [{ ...item, vod_play_url: '第1集$https://example.com/1.m3u8' }],
        }),
      ),
    );
    expect(await active).toHaveLength(1);
    expect(await searchFromApi(site, 'shared')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recordSourceSearchOutcome).toHaveBeenCalledTimes(1);
    expect(recordSourceSearchOutcome).toHaveBeenCalledWith(
      'a',
      'ok',
      expect.any(Number),
    );
  } finally {
    actual.clearSearchCachesForTests();
    dedupeMock.mockImplementation((_source, _query, _page, loader) => loader());
  }
});

describe('first-page failure reporting', () => {
  it('rejects with SearchSourceUnavailableError only when the caller asks for it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, body: null });
    await expect(searchFromApi(site, 'movie')).resolves.toEqual([]);
    await expect(
      searchFromApi(site, 'movie', { reportFailure: true }),
    ).rejects.toBeInstanceOf(SearchSourceUnavailableError);
  });

  it('treats a cached timeout page as a failure', async () => {
    (getCachedSearchPage as jest.Mock).mockReturnValue({
      status: 'timeout',
      data: [],
    });
    await expect(
      searchFromApi(site, 'movie', { reportFailure: true }),
    ).rejects.toBeInstanceOf(SearchSourceUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a successful empty page as an empty result', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ list: [] })));
    await expect(
      searchFromApi(site, 'movie', { reportFailure: true }),
    ).resolves.toEqual([]);
  });

  it('bypasses cached first-page failures when refreshing', async () => {
    (getCachedSearchPage as jest.Mock).mockReturnValue({
      status: 'timeout',
      data: [],
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          list: [{ ...item, vod_play_url: '1$https://example.com/1.m3u8' }],
        }),
      ),
    );
    const results = await searchFromApi(site, 'movie', {
      reportFailure: true,
      refreshFirstPage: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dedupeSearchLoad).not.toHaveBeenCalled();
    expect(results.map((result) => result.title)).toEqual(['Movie']);
  });
});
