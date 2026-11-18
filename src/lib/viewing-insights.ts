import type {
  FavoriteWatchStatus,
  PublicUserRef,
  VideoReview,
} from '@/lib/types';

export interface FollowOpinions {
  watchedCount: number;
  ratedCount: number;
  averageRating: number | null;
  items: {
    author: PublicUserRef;
    status: FavoriteWatchStatus | null;
    rating: number | null;
    hasPublicReview: boolean;
  }[];
}

export type TasteMatchPick = Pick<
  VideoReview,
  'title_norm' | 'title' | 'year' | 'cover' | 'rating'
>;

export interface TasteMatch {
  commonCount: number;
  score: number | null;
  picks: TasteMatchPick[];
}

export function tasteMatchScore(
  commonCount: number,
  totalDifference: number,
): number | null {
  if (commonCount < 5) return null;
  const mad = totalDifference / commonCount;
  return Math.round(100 * Math.max(0, Math.min(1, 1 - mad / 4.5)));
}
