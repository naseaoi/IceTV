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
  trackingEnabled?: boolean;
  // 同键播放记录存在时由它接管追更，否则开关写在收藏上；目录与直播收藏不追更
  trackingTarget?: 'record' | 'favorite';
};
