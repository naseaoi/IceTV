import type {
  FavoriteFilter,
  FavoriteFilterCounts,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import type { FavoritePageItem } from '@/lib/types';

export interface FavoriteLibraryQuery {
  query: string;
  filter: FavoriteFilter;
  sort: FavoriteSort;
  cursor?: string | null;
}

export interface FavoriteLibraryPage {
  items: (FavoritePageItem & { myRating: number | null })[];
  counts: FavoriteFilterCounts;
  total: number;
  libraryTotal: number;
  nextCursor: string | null;
}
