import type { HomeInitialData } from './home.types';
import {
  getHomeClientSnapshot,
  HOME_CLIENT_SNAPSHOT_MAX_AGE_MS,
  mergeHomeInitialDataWithClientSnapshot,
  writeHomeClientSnapshot,
} from './home-client-cache';

const initialData: HomeInitialData = {
  hotMovies: [],
  hotTvShows: [],
  hotVarietyShows: [],
  bangumiCalendarData: [],
};

describe('home-client-cache', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the latest complete home snapshot', () => {
    writeHomeClientSnapshot(initialData, 3);

    expect(getHomeClientSnapshot()).toEqual({
      initialData,
      continueWatchingSkeletonCount: 3,
      updatedAt: expect.any(Number),
    });
  });

  it('expires snapshots after the configured max age', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    writeHomeClientSnapshot(initialData, 0);

    jest.advanceTimersByTime(HOME_CLIENT_SNAPSHOT_MAX_AGE_MS);

    expect(getHomeClientSnapshot()).toBeNull();
  });

  it('keeps cached sections when refreshed server data is incomplete', () => {
    const cachedMovie = {
      id: 'cached-movie',
      title: '缓存电影',
      poster: 'cached.jpg',
      rate: '8.0',
      year: '2026',
    };
    const freshTvShow = {
      id: 'fresh-tv',
      title: '最新剧集',
      poster: 'fresh.jpg',
      rate: '9.0',
      year: '2026',
    };
    const cachedData: HomeInitialData = {
      ...initialData,
      hotMovies: [cachedMovie],
    };
    writeHomeClientSnapshot(cachedData, 0);

    expect(
      mergeHomeInitialDataWithClientSnapshot({
        ...initialData,
        hotTvShows: [freshTvShow],
      }),
    ).toEqual({
      ...initialData,
      hotMovies: [cachedMovie],
      hotTvShows: [freshTvShow],
    });
  });
});
