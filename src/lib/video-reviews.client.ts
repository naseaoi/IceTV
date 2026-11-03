import { fetchWithAuth } from '@/lib/db.client.internal';
import { socialRequest } from '@/lib/profile.client';
import type { ReviewReportReason } from '@/lib/types';
import type { VideoReview, WorkReviewSummary } from '@/lib/types';

export { REVIEW_CONTENT_MAX_LENGTH } from '@/lib/video-reviews';

export interface VideoReviewInput {
  title: string;
  year: string;
  cover: string;
  douban_id: number;
  rating: number | null;
  content: string;
  is_public: boolean;
  spoiler?: boolean;
  source_key: string;
}

function buildWorkQuery(title: string, year: string): string {
  return new URLSearchParams({ title, year }).toString();
}

export async function fetchMyVideoReview(
  title: string,
  year: string,
): Promise<VideoReview | null> {
  const res = await fetchWithAuth(
    `/api/reviews?${buildWorkQuery(title, year)}`,
  );
  const data = (await res.json()) as { review?: VideoReview | null };
  return data.review ?? null;
}

export async function fetchWorkReviewSummary(
  title: string,
  year: string,
): Promise<WorkReviewSummary> {
  const res = await fetchWithAuth(
    `/api/reviews/work?${buildWorkQuery(title, year)}`,
  );
  const data = (await res.json()) as Partial<WorkReviewSummary>;
  return {
    average: typeof data.average === 'number' ? data.average : null,
    count: typeof data.count === 'number' ? data.count : 0,
    distribution: data.distribution ?? Array(10).fill(0),
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
  };
}

export async function saveVideoReview(
  input: VideoReviewInput,
): Promise<VideoReview> {
  const data = await socialRequest<{ review: VideoReview }>('/api/reviews', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.review;
}

export async function deleteVideoReview(
  title: string,
  year: string,
  exactTitleNorm?: string,
): Promise<void> {
  const query =
    exactTitleNorm === undefined
      ? buildWorkQuery(title, year)
      : new URLSearchParams({
          exact: '1',
          title_norm: exactTitleNorm,
          year,
        }).toString();
  await fetchWithAuth(`/api/reviews?${query}`, {
    method: 'DELETE',
  });
}

export async function fetchMyVideoReviews(): Promise<VideoReview[]> {
  const res = await fetchWithAuth('/api/reviews/mine');
  const data = (await res.json()) as { reviews?: VideoReview[] };
  return Array.isArray(data.reviews) ? data.reviews : [];
}

export interface ReviewTarget {
  profileId: string;
  title_norm: string;
  year: string;
}
export function setReviewLiked(target: ReviewTarget, liked: boolean) {
  return socialRequest<{ liked: boolean; likeCount: number }>(
    liked
      ? '/api/reviews/likes'
      : `/api/reviews/likes?${new URLSearchParams({ ...target })}`,
    {
      method: liked ? 'PUT' : 'DELETE',
      ...(liked
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(target),
          }
        : {}),
    },
  );
}
export function reportVideoReview(
  target: ReviewTarget,
  reason: ReviewReportReason,
  detail: string,
) {
  return socialRequest<{ ok: true }>('/api/reviews/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, reason, detail }),
  });
}
