import type { FavoriteWatchStatus } from '@/lib/types';

export type FavoriteItem = {
  id: string;
  source: string;
  title: string;
  year?: string;
  poster: string;
  episodes: number;
  source_name: string;
  currentEpisode?: number;
  progress?: number;
  search_title?: string;
  origin?: 'vod' | 'live';
  myRating?: number;
  watchStatus?: FavoriteWatchStatus;
  watchStatusManual?: boolean;
  watchedAt?: number | null;
};
