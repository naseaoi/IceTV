import type { FavoriteWatchStatus } from '@/lib/types';

export type FavoriteFilter = 'all' | FavoriteWatchStatus;
export type FavoriteReviewFilter = 'all' | 'reviewed' | 'unreviewed';
export type FavoriteSort = 'saved' | 'played' | 'watched' | 'rating' | 'year';
export type FavoriteFilterCounts = Record<FavoriteFilter, number>;
