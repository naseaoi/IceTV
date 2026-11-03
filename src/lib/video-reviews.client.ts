import { fetchWithAuth } from '@/lib/db.client.internal';
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
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
  };
}

export async function saveVideoReview(
  input: VideoReviewInput,
): Promise<VideoReview> {
  const res = await fetchWithAuth('/api/reviews', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { review: VideoReview };
  return data.review;
}

export async function deleteVideoReview(
  title: string,
  year: string,
): Promise<void> {
  await fetchWithAuth(`/api/reviews?${buildWorkQuery(title, year)}`, {
    method: 'DELETE',
  });
}

export async function fetchMyVideoReviews(): Promise<VideoReview[]> {
  const res = await fetchWithAuth('/api/reviews/mine');
  const data = (await res.json()) as { reviews?: VideoReview[] };
  return Array.isArray(data.reviews) ? data.reviews : [];
}
