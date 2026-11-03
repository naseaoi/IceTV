/** @jest-environment node */

import { setImmediate } from 'node:timers';

jest.mock('@/features/bangumi/lib/bangumi', () => ({
  getCachedBangumiCalendarData: jest.fn(() => []),
}));
jest.mock('@/lib/config', () => ({
  getPublicConfig: jest.fn(async () => ({ DoubanImageProxyType: 'direct' })),
}));
jest.mock('@/lib/douban-image-url.server', () => ({
  readServerDoubanImageProxyType: jest.fn(async () => 'direct'),
}));
jest.mock('@/lib/douban', () => ({ fetchDoubanData: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: {} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushBackground() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function hotItem(id: string) {
  return {
    id,
    title: `Title ${id}`,
    card_subtitle: '2026 / Region / Drama / Director / Actor',
    pic: { normal: `https://img.example/${id}.jpg` },
    rating: { value: 8 },
  };
}

describe('home server hero intros', () => {
  let getHomeInitialData: typeof import('./home.server').getHomeInitialData;
  let fetchDoubanData: jest.Mock;
  let loadIntro: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    ({ getHomeInitialData } = require('./home.server'));
    ({ fetchDoubanData } = require('@/lib/douban'));
    loadIntro = jest.fn(async () => ({ intro: 'Cached intro' }));
    fetchDoubanData.mockImplementation((url: string) => {
      if (url.includes('/recent_hot/movie')) {
        return Promise.resolve({ items: ['1', '2', '3'].map(hotItem) });
      }
      if (url.includes('/recent_hot/tv')) {
        return Promise.resolve({ items: ['4', '5', '6'].map(hotItem) });
      }
      return loadIntro(url);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function loadWithoutWaiting() {
    return Promise.race([
      getHomeInitialData(),
      flushBackground().then(() => {
        throw new Error('Home initial data waited for an intro fetch');
      }),
    ]);
  }

  it('returns lists without waiting for cold intros and coalesces concurrent loads', async () => {
    const pending = deferred<{ intro: string }>();
    loadIntro.mockReturnValue(pending.promise);

    const pages = await Promise.all([
      loadWithoutWaiting(),
      loadWithoutWaiting(),
    ]);

    for (const page of pages) {
      expect(page.hotMovies).toHaveLength(3);
      expect(page.hotTvShows).toHaveLength(3);
      expect(page.hotVarietyShows).toHaveLength(3);
      expect(page.heroItems).toHaveLength(5);
      expect(page.heroItems.every((item) => item.intro === undefined)).toBe(
        true,
      );
    }
    expect(loadIntro).toHaveBeenCalledTimes(5);
    expect(loadIntro).toHaveBeenCalledWith(
      'https://m.douban.com/rexxar/api/v2/movie/1',
    );
    expect(loadIntro).toHaveBeenCalledWith(
      'https://m.douban.com/rexxar/api/v2/tv/4',
    );

    pending.resolve({ intro: `  Intro\n text ${'x'.repeat(400)}  ` });
    await flushBackground();

    const warmed = await loadWithoutWaiting();
    expect(warmed.heroItems.map((item) => item.intro)).toEqual(
      Array(5).fill(`Intro text ${'x'.repeat(400)}`.slice(0, 300)),
    );
    expect(loadIntro).toHaveBeenCalledTimes(5);
  });

  it('serves stale intros while refreshing them in the background', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await loadWithoutWaiting();
    await flushBackground();
    clock.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000 + 1);
    const pending = deferred<{ intro: string }>();
    loadIntro.mockReturnValue(pending.promise);

    const stale = await loadWithoutWaiting();
    expect(stale.heroItems.map((item) => item.intro)).toEqual(
      Array(5).fill('Cached intro'),
    );
    expect(loadIntro).toHaveBeenCalledTimes(10);

    pending.resolve({ intro: 'Refreshed intro' });
    await flushBackground();
    const refreshed = await loadWithoutWaiting();
    expect(refreshed.heroItems.map((item) => item.intro)).toEqual(
      Array(5).fill('Refreshed intro'),
    );
    expect(loadIntro).toHaveBeenCalledTimes(10);
  });

  it('swallows background failures and retries on a later request', async () => {
    const pending = deferred<{ intro: string }>();
    loadIntro.mockReturnValue(pending.promise);
    await loadWithoutWaiting();

    pending.reject(new Error('Upstream unavailable'));
    await flushBackground();
    loadIntro.mockResolvedValue({ intro: 'Recovered intro' });
    await loadWithoutWaiting();
    await flushBackground();

    const recovered = await loadWithoutWaiting();
    expect(recovered.heroItems.map((item) => item.intro)).toEqual(
      Array(5).fill('Recovered intro'),
    );
    expect(loadIntro).toHaveBeenCalledTimes(10);
  });

  it('caches empty intros without repeatedly fetching details', async () => {
    loadIntro.mockResolvedValue({});
    await loadWithoutWaiting();
    await flushBackground();

    const page = await loadWithoutWaiting();
    expect(page.heroItems.every((item) => item.intro === undefined)).toBe(true);
    expect(loadIntro).toHaveBeenCalledTimes(5);
  });

  it('does not fetch details for invalid subject ids', async () => {
    fetchDoubanData.mockResolvedValue({ items: [hotItem('../invalid')] });

    const page = await loadWithoutWaiting();
    expect(page.heroItems.length).toBeGreaterThan(0);
    expect(page.heroItems.every((item) => item.intro === undefined)).toBe(true);
    expect(loadIntro).not.toHaveBeenCalled();
    expect(fetchDoubanData).toHaveBeenCalledTimes(3);
  });
});
