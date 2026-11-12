/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { getCachedDetail } from '@/lib/detail-cache';
import { searchFirstPageFromApi } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';

import { installWebPolyfills } from '../../test-utils/web-polyfills';

installWebPolyfills();

type Plan = { delayMs: number; playable: boolean };
const plans: Record<string, Plan> = {};
let healthTiers = new Map<string, string>();
let proxyModes: Record<string, string | undefined> = {};

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(async () => ({ username: 'alice' })),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(async () => ({
    SiteConfig: { DisableYellowFilter: true },
    SourceConfig: Object.keys(plans).map((key) => ({
      key,
      proxyMode: proxyModes[key],
    })),
  })),
  getAvailableApiSites: jest.fn(async () =>
    Object.keys(plans).map((key) => ({ key, name: key, api: key })),
  ),
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn(async () => healthTiers),
}));
jest.mock('@/lib/yellow', () => ({ yellowWords: ['成人'] }));
jest.mock('@/lib/downstream', () => ({
  searchFirstPageFromApi: jest.fn(async (site: { key: string }) => [
    { source: site.key, id: '1', title: 'Show', episodes: [] },
  ]),
}));
jest.mock('@/lib/detail-cache', () => ({
  getCachedDetail: jest.fn(async (site: { key: string }) => {
    const plan = plans[site.key];
    await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
    return { episodes: plan.playable ? ['ep1.m3u8'] : [] };
  }),
}));

const { GET } = require('./route') as typeof import('./route');

async function quickWinner(): Promise<{ source: string; ms: number }> {
  const started = Date.now();
  const response = await GET({
    url: 'http://localhost/api/search/quick?q=Show',
    signal: new AbortController().signal,
  } as NextRequest);
  const body = (await response.json()) as { detail: { source: string } };
  return { source: body.detail.source, ms: Date.now() - started };
}

function setPlans(next: Record<string, Plan>) {
  for (const key of Object.keys(plans)) delete plans[key];
  Object.assign(plans, next);
}

describe('quick search route preference', () => {
  beforeEach(() => {
    healthTiers = new Map();
    proxyModes = {};
  });

  it('waits briefly for a direct source of the same health tier', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 200, playable: true },
    });
    proxyModes = { relay: 'server' };

    await expect(quickWinner()).resolves.toMatchObject({ source: 'direct' });
  });

  it('treats auto sources as direct candidates', async () => {
    setPlans({
      blocked: { delayMs: 5, playable: true },
      direct: { delayMs: 200, playable: true },
    });
    proxyModes = { blocked: 'auto' };

    await expect(quickWinner()).resolves.toMatchObject({ source: 'blocked' });
  });

  it('returns the relay source once no direct peer can win', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 50, playable: false },
    });
    proxyModes = { relay: 'server' };

    const winner = await quickWinner();
    expect(winner.source).toBe('relay');
    expect(winner.ms).toBeLessThan(1_000);
  });

  it('does not wait for direct sources with worse health', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 300, playable: true },
    });
    proxyModes = { relay: 'server' };
    healthTiers = new Map([
      ['relay', 'good'],
      ['direct', 'poor'],
    ]);

    const winner = await quickWinner();
    expect(winner.source).toBe('relay');
    expect(winner.ms).toBeLessThan(250);
  });

  it('falls back to the relay source after the grace window', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 1_900, playable: true },
    });
    proxyModes = { relay: 'server' };

    const winner = await quickWinner();
    expect(winner.source).toBe('relay');
    expect(winner.ms).toBeLessThan(1_850);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function playable(source = 'direct'): SearchResult {
  return {
    source,
    id: '1',
    title: 'Show',
    poster: 'https://image.test/1.jpg',
    source_name: source,
    year: '2026',
    episodes: ['https://media.test/1.m3u8'],
    episodes_titles: ['第1集'],
  };
}

const searchMock = searchFirstPageFromApi as jest.Mock;
const detailMock = getCachedDetail as jest.Mock;

function request(signal = new AbortController().signal, query = 'q=Show') {
  return GET({
    url: `http://localhost/api/search/quick?${query}`,
    signal,
  } as NextRequest);
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('quick search readiness and cancellation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    healthTiers = new Map();
    proxyModes = {};
    setPlans({ direct: { delayMs: 0, playable: true } });
    searchMock.mockImplementation(async (site: { key: string }) => [
      playable(site.key),
    ]);
    detailMock.mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => jest.useRealTimers());

  it('returns a complete ordinary search result without waiting for detail and warms only its detail cache', async () => {
    const response = await request();
    expect((await response.json()).detail).toEqual(playable());
    expect(detailMock).toHaveBeenCalledTimes(1);
    expect(detailMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'direct' }),
      '1',
    );
  });

  it.each([
    { episodes: [], episodes_titles: [] },
    { episodes: ['icetv-lazy://giri/1'] },
    { episode_groups: [{ label: '第一季', start: 0, end: 1 }] },
    { related_sources: [playable('other')] },
    { variant_label: '剧场版' },
    { episodes_titles: [] },
    { year: 'unknown' },
  ])(
    'waits for detail when the search result needs confirmation: %j',
    async (patch) => {
      searchMock.mockResolvedValue([{ ...playable(), ...patch }]);
      const detail = deferred<SearchResult>();
      detailMock.mockReturnValue(detail.promise);
      let settled = false;
      const response = request().then((value) => {
        settled = true;
        return value;
      });
      await flush();
      expect(settled).toBe(false);
      expect(detailMock).toHaveBeenCalledWith(
        expect.any(Object),
        '1',
        expect.any(AbortSignal),
      );
      detail.resolve({ ...playable(), poster: 'fresh', year: '2025' });
      expect((await (await response).json()).detail).toMatchObject({
        poster: 'fresh',
        year: '2025',
      });
    },
  );

  it('retains search fallback when required detail fails and does not fabricate empty episodes', async () => {
    const incomplete = { ...playable(), year: 'unknown' };
    searchMock.mockResolvedValue([incomplete]);
    detailMock.mockRejectedValue(new Error('upstream unavailable'));
    expect((await (await request()).json()).detail).toEqual(incomplete);
    searchMock.mockResolvedValue([{ ...incomplete, episodes: [] }]);
    expect((await (await request()).json()).detail).toBeNull();
  });

  it('does not start detail after a cancelled search finishes', async () => {
    const search = deferred<SearchResult[]>();
    searchMock.mockReturnValue(search.promise);
    const controller = new AbortController();
    const response = request(controller.signal);
    await flush();
    controller.abort();
    expect((await (await response).json()).detail).toBeNull();
    search.resolve([{ ...playable(), episodes: [] }]);
    await flush();
    expect(detailMock).not.toHaveBeenCalled();
  });

  it('does not start a losing second candidate after the winner returns', async () => {
    setPlans({
      direct: { delayMs: 0, playable: true },
      loser: { delayMs: 0, playable: false },
    });
    searchMock.mockImplementation(async (site: { key: string }) => [
      { ...playable(site.key), episodes: [] },
      { ...playable(site.key), id: '2', episodes: [] },
    ]);
    const winning = deferred<SearchResult>();
    const losing = deferred<SearchResult>();
    detailMock.mockImplementation((site: { key: string }) =>
      site.key === 'direct' ? winning.promise : losing.promise,
    );
    const response = request();
    await flush();
    winning.resolve(playable());
    expect((await (await response).json()).detail.source).toBe('direct');
    losing.resolve({ ...playable('loser'), episodes: [] });
    await flush();
    expect(detailMock.mock.calls.map((call) => call[1])).toEqual(['1', '1']);
  });

  it('client cancellation settles immediately and prevents candidates and queued sources from starting', async () => {
    setPlans(
      Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `s${i}`,
          { delayMs: 0, playable: false },
        ]),
      ),
    );
    searchMock.mockImplementation(async (site: { key: string }) => [
      { ...playable(site.key), episodes: [] },
      { ...playable(site.key), id: '2', episodes: [] },
    ]);
    const detail = deferred<SearchResult>();
    detailMock.mockReturnValue(detail.promise);
    const controller = new AbortController();
    const response = request(controller.signal);
    await flush();
    expect(detailMock).toHaveBeenCalledTimes(4);
    controller.abort();
    expect((await (await response).json()).detail).toBeNull();
    detail.resolve({ ...playable(), episodes: [] });
    await flush();
    expect(searchMock).toHaveBeenCalledTimes(4);
    expect(detailMock).toHaveBeenCalledTimes(4);
  });

  it('does not start work for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (await (await request(controller.signal)).json()).searchedSources,
    ).toBe(0);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('releases offline slots after five seconds across search and detail', async () => {
    setPlans(
      Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [
          `s${i}`,
          { delayMs: 0, playable: false },
        ]),
      ),
    );
    healthTiers = new Map(Object.keys(plans).map((key) => [key, 'offline']));
    searchMock.mockImplementation(async (site: { key: string }) => {
      if (site.key !== 's4')
        await new Promise((resolve) => setTimeout(resolve, 3000));
      return site.key === 's4'
        ? [playable('s4')]
        : [{ ...playable(site.key), episodes: [] }];
    });
    const response = request();
    await flush();
    jest.advanceTimersByTime(4999);
    await flush();
    expect(searchMock).toHaveBeenCalledTimes(4);
    expect(detailMock).toHaveBeenCalledTimes(4);
    jest.advanceTimersByTime(1);
    await flush();
    expect((await (await response).json()).detail.source).toBe('s4');
    expect(searchMock).toHaveBeenCalledTimes(5);
  });

  it('retains title, year and type matching before the direct-start shortcut', async () => {
    searchMock.mockResolvedValue([
      { ...playable(), id: 'wrong-title', title: 'Other' },
      { ...playable(), id: 'wrong-year', year: '2025' },
      {
        ...playable(),
        id: 'wrong-type',
        episodes: ['https://a/1.mp4', 'https://a/2.mp4'],
      },
      playable(),
    ]);
    expect(
      (await (await request(undefined, 'q=Show&year=2026&stype=movie')).json())
        .sources,
    ).toEqual([playable()]);
  });

  it('limits the ranked source list to ten', async () => {
    setPlans(
      Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [
          `s${i}`,
          { delayMs: 0, playable: false },
        ]),
      ),
    );
    searchMock.mockResolvedValue([]);
    expect((await (await request()).json()).searchedSources).toBe(10);
    expect(searchMock).toHaveBeenCalledTimes(10);
  });
});
