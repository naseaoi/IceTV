import { fetchWithAuth } from '@/lib/db.client.internal';
import { socialRequest } from '@/lib/profile.client';
import type { PublicVideoReview, ReviewTarget } from '@/lib/types';
import type {
  PublicReviewReply,
  PublicReviewReplyPage,
  ReviewReportReason,
} from '@/lib/types';
import type {
  MyVideoReviewPage,
  VideoReview,
  VideoReviewRating,
  WorkReviewSummary,
} from '@/lib/types';
import {
  type MyReviewQuery,
  VIDEO_REVIEWS_UPDATED_EVENT,
} from '@/lib/video-reviews';

export {
  REVIEW_CONTENT_MAX_LENGTH,
  REVIEW_REPLY_MAX_LENGTH,
} from '@/lib/video-reviews';

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
  cursor?: string,
): Promise<WorkReviewSummary> {
  const res = await fetchWithAuth(
    `/api/reviews/work?${buildWorkQuery(title, year)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  const data = (await res.json()) as Partial<WorkReviewSummary>;
  return {
    average: typeof data.average === 'number' ? data.average : null,
    count: typeof data.count === 'number' ? data.count : 0,
    distribution: data.distribution ?? Array(10).fill(0),
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
    nextCursor: data.nextCursor ?? null,
    reviewCount: data.reviewCount ?? 0,
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
  window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT));
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
  window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT));
}

export async function fetchMyVideoReviews(
  query: MyReviewQuery = {},
  signal?: AbortSignal,
): Promise<MyVideoReviewPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value) params.set(key, value);
  const res = await fetchWithAuth(`/api/reviews/mine?${params}`, { signal });
  return res.json();
}

export async function fetchMyVideoReviewCount(): Promise<number> {
  const res = await fetchWithAuth('/api/reviews/mine?view=count');
  const data = await res.json();
  return data.count;
}

export async function fetchMyVideoReviewRatings(): Promise<
  VideoReviewRating[]
> {
  const res = await fetchWithAuth('/api/reviews/mine?view=ratings');
  const data = await res.json();
  return data.ratings;
}

export type { ReviewTarget } from '@/lib/types';
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

export function fetchReviewReplies(target: ReviewTarget, cursor?: string) {
  const query = new URLSearchParams({
    ...target,
    ...(cursor ? { cursor } : {}),
  });
  return socialRequest<PublicReviewReplyPage>(`/api/reviews/replies?${query}`);
}
export function postReviewReply(
  target: ReviewTarget,
  content: string,
  replyToId?: string,
) {
  return socialRequest<PublicReviewReply>('/api/reviews/replies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, content, replyToId }),
  });
}
export function deleteReviewReply(id: string) {
  return socialRequest<{ ok: true }>(
    `/api/reviews/replies?${new URLSearchParams({ id })}`,
    { method: 'DELETE' },
  );
}
export function reportReviewReply(
  id: string,
  reason: ReviewReportReason,
  detail: string,
) {
  return socialRequest<{ ok: true }>('/api/reviews/replies/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, reason, detail }),
  });
}

export async function fetchPublicReview(
  target: ReviewTarget,
): Promise<PublicVideoReview | null> {
  const result = await socialRequest<{ review: PublicVideoReview | null }>(
    `/api/reviews/single?${new URLSearchParams({ ...target })}`,
  );
  return result.review;
}
