import type {
  AnnualRecapShareState,
  AnnualReport,
  PublicAnnualReport,
} from '@/features/playback-stats/types';
import type { StoredAnnualRecap } from '@/lib/annual-recap-storage';
import type { VideoReview } from '@/lib/types';

import { buildPlaybackPeriod } from './period';

export function annualShareState(
  year: number,
  recap: StoredAnnualRecap | null,
): AnnualRecapShareState {
  return {
    year,
    published: recap !== null,
    hideRhythm: recap?.hideRhythm ?? false,
    publishedAt: recap?.publishedAt ?? null,
    updatedAt: recap?.updatedAt ?? null,
  };
}

export function publicAnnualReport(
  report: AnnualReport,
  reviews: VideoReview[],
  hideRhythm: boolean,
): PublicAnnualReport {
  const { availableYears: _years, ...snapshot } = report;
  const period = buildPlaybackPeriod(
    { type: 'year', date: `${report.year}-01-01`, timeZone: report.timeZone },
    report.generatedAt,
  );
  const publicReviews = reviews.filter(
    (review) =>
      review.is_public &&
      review.created_at >= period.start &&
      review.created_at < period.end,
  );
  const rated = publicReviews.filter(
    (review): review is VideoReview & { rating: number } =>
      review.rating !== null,
  );
  const top = [...rated].sort(
    (a, b) => b.rating - a.rating || b.created_at - a.created_at,
  )[0];
  return {
    ...snapshot,
    rhythmHidden: hideRhythm,
    ...(hideRhythm
      ? {
          hours: Array<number>(24).fill(0),
          weekdays: Array<number>(7).fill(0),
          lateNightWatchSeconds: 0,
          latestNight: null,
        }
      : {}),
    reviews: {
      count: publicReviews.length,
      ratedCount: rated.length,
      averageRating: rated.length
        ? Math.round(
            (rated.reduce((sum, review) => sum + review.rating, 0) /
              rated.length) *
              10,
          ) / 10
        : null,
      topRated: top
        ? {
            title: top.title,
            year: top.year,
            cover: top.cover,
            rating: top.rating,
          }
        : null,
    },
  };
}
