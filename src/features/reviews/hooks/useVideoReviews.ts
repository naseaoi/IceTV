import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { VideoReview, WorkReviewSummary } from '@/lib/types';
import {
  type VideoReviewInput,
  deleteVideoReview,
  fetchMyVideoReview,
  fetchWorkReviewSummary,
  saveVideoReview,
} from '@/lib/video-reviews.client';

export type VideoReviewDraft = Pick<
  VideoReviewInput,
  'rating' | 'content' | 'is_public' | 'spoiler'
>;

export interface UseVideoReviewsOptions {
  title: string;
  year: string;
  cover: string;
  doubanId: number;
  sourceKey: string;
  // 公开评价列表只在评价面板可见时加载
  summaryEnabled: boolean;
  // 列表已持有本人评价时直接复用，避免额外读取覆盖正在编辑的快照
  initialReview?: VideoReview;
}

export interface VideoReviewsState {
  myReview: VideoReview | null;
  myReviewLoading: boolean;
  summary: WorkReviewSummary | null;
  summaryLoading: boolean;
  summaryError: boolean;
  save: (draft: VideoReviewDraft) => Promise<VideoReview>;
  remove: () => Promise<void>;
  reloadSummary: () => void;
  loadMoreReviews?: () => void;
  reviewsLoadingMore?: boolean;
}

// 以作品身份为 key：换源后归一化标题与年份不变时沿用已加载的数据，不重复请求
export function useVideoReviews({
  title,
  year,
  cover,
  doubanId,
  sourceKey,
  summaryEnabled,
  initialReview,
}: UseVideoReviewsOptions): VideoReviewsState {
  const workKey = `${normalizeWorkTitle(title)}\u0000${normalizeWorkYear(year)}`;
  const hasWork = normalizeWorkTitle(title).length > 0;

  const [myReview, setMyReview] = useState<VideoReview | null>(
    initialReview ?? null,
  );
  const initialReviewRef = useRef(initialReview);
  initialReviewRef.current = initialReview;
  const [myReviewLoading, setMyReviewLoading] = useState(false);
  const [summary, setSummary] = useState<WorkReviewSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [reviewsLoadingMore, setReviewsLoadingMore] = useState(false);
  const moreInFlight = useRef(false);
  const summaryGeneration = useRef(0);

  const latestRef = useRef({ title, year, cover, doubanId, sourceKey });
  latestRef.current = { title, year, cover, doubanId, sourceKey };
  const summaryLoadedKeyRef = useRef('');

  useEffect(() => {
    setMyReview(null);
    setSummary(null);
    setSummaryError(false);
    summaryLoadedKeyRef.current = '';
    setMyReviewLoading(false);
    if (!hasWork) return;
    const initial = initialReviewRef.current;
    if (
      initial &&
      `${normalizeWorkTitle(initial.title)}\u0000${normalizeWorkYear(initial.year)}` ===
        workKey
    ) {
      setMyReview(initial);
      return;
    }

    let cancelled = false;
    setMyReviewLoading(true);
    fetchMyVideoReview(latestRef.current.title, latestRef.current.year)
      .then((review) => {
        if (!cancelled) setMyReview(review);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMyReviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasWork, workKey]);

  useEffect(() => {
    summaryGeneration.current += 1;
    moreInFlight.current = false;
    setReviewsLoadingMore(false);
    return () => {
      summaryGeneration.current += 1;
    };
  }, [summaryEnabled, summaryVersion, workKey]);

  useEffect(() => {
    if (!hasWork || !summaryEnabled) return;
    const loadKey = `${workKey}\u0000${summaryVersion}`;
    if (summaryLoadedKeyRef.current === loadKey) return;

    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(false);
    fetchWorkReviewSummary(latestRef.current.title, latestRef.current.year)
      .then((result) => {
        if (cancelled) return;
        summaryLoadedKeyRef.current = loadKey;
        setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setSummaryError(true);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasWork, summaryEnabled, summaryVersion, workKey]);

  const loadMoreReviews = useCallback(async () => {
    if (!summary?.nextCursor || moreInFlight.current || summaryLoading) return;
    const generation = summaryGeneration.current;
    moreInFlight.current = true;
    setReviewsLoadingMore(true);
    setSummaryError(false);
    try {
      const page = await fetchWorkReviewSummary(
        latestRef.current.title,
        latestRef.current.year,
        summary.nextCursor,
      );
      if (generation !== summaryGeneration.current) return;
      setSummary((previous) =>
        previous
          ? {
              ...page,
              reviews: [
                ...previous.reviews,
                ...page.reviews.filter(
                  (item) =>
                    !previous.reviews.some(
                      (existing) =>
                        existing.author.profileId === item.author.profileId &&
                        existing.year === item.year,
                    ),
                ),
              ],
            }
          : page,
      );
    } catch {
      if (generation === summaryGeneration.current) setSummaryError(true);
    } finally {
      if (generation === summaryGeneration.current) {
        moreInFlight.current = false;
        setReviewsLoadingMore(false);
      }
    }
  }, [summary, summaryLoading]);

  const reloadSummary = useCallback(() => {
    setSummaryVersion((version) => version + 1);
  }, []);

  const save = useCallback(
    async (draft: VideoReviewDraft) => {
      const current = latestRef.current;
      const review = await saveVideoReview({
        title: current.title,
        year: current.year,
        cover: current.cover,
        douban_id: current.doubanId,
        source_key: current.sourceKey,
        ...draft,
      });
      setMyReview(review);
      reloadSummary();
      return review;
    },
    [reloadSummary],
  );

  const remove = useCallback(async () => {
    const current = latestRef.current;
    await deleteVideoReview(current.title, current.year);
    setMyReview(null);
    reloadSummary();
  }, [reloadSummary]);

  return {
    myReview,
    myReviewLoading,
    summary,
    summaryLoading,
    summaryError,
    save,
    remove,
    reloadSummary,
    loadMoreReviews,
    reviewsLoadingMore,
  };
}
