import type { FavoriteWatchStatus } from '@/lib/types';

export type FavoriteFilter = 'all' | FavoriteWatchStatus | 'reviewed';
export type FavoriteSort = 'saved' | 'played' | 'watched' | 'rating' | 'year';
export type FavoriteFilterCounts = Record<FavoriteFilter, number>;
