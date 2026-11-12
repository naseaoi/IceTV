import type {
  FavoriteFilter,
  FavoriteFilterCounts,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import type { FavoritePageItem, FavoriteWatchStatus } from '@/lib/types';

export interface FavoriteLibraryQuery {
  query: string;
  filter: FavoriteFilter;
  sort: FavoriteSort;
  cursor?: string | null;
  limit?: number;
  profileScope?: 'public' | 'self';
}

export interface FavoriteLibraryItem extends FavoritePageItem {
  myRating: number | null;
  watchStatus: FavoriteWatchStatus;
  watchStatusManual: boolean;
  watchedAt: number | null;
}

export interface FavoriteBatchInput {
  action: 'set-status' | 'remove';
  target:
    | { keys: string[] }
    | { match: { q: string; filter: FavoriteFilter }; exclude: string[] };
  watchStatus?: FavoriteWatchStatus | null;
  watchedAt?: number | null;
}

export interface FavoriteWorkQuery {
  key: string;
  title: string;
  year: string;
}

export interface FavoriteLibraryPage {
  items: FavoriteLibraryItem[];
  counts: FavoriteFilterCounts;
  total: number;
  libraryTotal: number;
  nextCursor: string | null;
}
