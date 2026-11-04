/** @jest-environment node */

import type { ApiSite } from '@/lib/config';
import { probeSourceSearch, searchFromApi } from '@/lib/downstream';
import {
  dedupeSearchLoad,
  getCachedSearchPage,
  peekCachedSearchPage,
} from '@/lib/search-cache';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { recordSourceSearchOutcome } from '@/lib/source-health.server';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { headers: {}, path: '?wd=', pagePath: '?wd={query}&pg={page}' },
  },
  getConfigForRead: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { SearchRequestTimeoutSeconds: 8 } }),
}));
jest.mock('@/lib/search-cache', () => ({
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
      return {
        ok: true,
        json: async () => {
          jest.advanceTimersByTime(50);
          return { list };
        },
      };
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
      return {
        ok: true,
        json: async () => {
          if (failure === 'json') throw new SyntaxError('invalid JSON');
          return { list: 'invalid' };
        },
      };
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
  const result = searchFromApi(site, 'movie', { signal: parent.signal });
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
  await searchFromApi(site, 'movie', { signal: parent.signal });
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
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ list: [], pagecount: 2 }),
  });
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
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ list: [] }) });
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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ list, pagecount: 5 }),
    });
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
