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
};
