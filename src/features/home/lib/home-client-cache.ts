'use client';

import type { HomeInitialData } from './home.types';

export const HOME_CLIENT_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

export interface HomeClientSnapshot {
  initialData: HomeInitialData;
  continueWatchingSkeletonCount: number;
  updatedAt: number;
}

let homeClientSnapshot: HomeClientSnapshot | null = null;

export function getHomeClientSnapshot(): HomeClientSnapshot | null {
  if (!homeClientSnapshot) {
    return null;
  }

  if (
    homeClientSnapshot.updatedAt + HOME_CLIENT_SNAPSHOT_MAX_AGE_MS <=
    Date.now()
  ) {
    homeClientSnapshot = null;
    return null;
  }

  return homeClientSnapshot;
}

export function writeHomeClientSnapshot(
  initialData: HomeInitialData,
  continueWatchingSkeletonCount: number,
): void {
  homeClientSnapshot = {
    initialData,
    continueWatchingSkeletonCount,
    updatedAt: Date.now(),
  };
}

export function mergeHomeInitialDataWithClientSnapshot(
  initialData: HomeInitialData,
): HomeInitialData {
  const snapshot = getHomeClientSnapshot();
  if (!snapshot) {
    return initialData;
  }

  const cached = snapshot.initialData;
  const hasBangumiData = initialData.bangumiCalendarData.some(
    (weekday) => weekday.items.length > 0,
  );

  return {
    hotMovies:
      initialData.hotMovies.length > 0
        ? initialData.hotMovies
        : cached.hotMovies,
    hotTvShows:
      initialData.hotTvShows.length > 0
        ? initialData.hotTvShows
        : cached.hotTvShows,
    hotVarietyShows:
      initialData.hotVarietyShows.length > 0
        ? initialData.hotVarietyShows
        : cached.hotVarietyShows,
    bangumiCalendarData: hasBangumiData
      ? initialData.bangumiCalendarData
      : cached.bangumiCalendarData,
  };
}
