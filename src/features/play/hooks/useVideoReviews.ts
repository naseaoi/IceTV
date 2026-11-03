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
  'rating' | 'content' | 'is_public'
>;

interface UseVideoReviewsOptions {
  title: string;
  year: string;
  cover: string;
  doubanId: number;
  sourceKey: string;
  // 公开评价列表只在评价面板可见时加载
  summaryEnabled: boolean;
}

export interface VideoReviewsState {
  myReview: VideoReview | null;
  myReviewLoading: boolean;
  summary: WorkReviewSummary | null;
  summaryLoading: boolean;
  summaryError: boolean;
  save: (draft: VideoReviewDraft) => Promise<void>;
  remove: () => Promise<void>;
  reloadSummary: () => void;
}

// 以作品身份为 key：换源后归一化标题与年份不变时沿用已加载的数据，不重复请求
export function useVideoReviews({
  title,
  year,
  cover,
  doubanId,
  sourceKey,
  summaryEnabled,
}: UseVideoReviewsOptions): VideoReviewsState {
  const workKey = `${normalizeWorkTitle(title)}\u0000${normalizeWorkYear(year)}`;
  const hasWork = normalizeWorkTitle(title).length > 0;

  const [myReview, setMyReview] = useState<VideoReview | null>(null);
  const [myReviewLoading, setMyReviewLoading] = useState(false);
  const [summary, setSummary] = useState<WorkReviewSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);

  const latestRef = useRef({ title, year, cover, doubanId, sourceKey });
  latestRef.current = { title, year, cover, doubanId, sourceKey };
  const summaryLoadedKeyRef = useRef('');

  useEffect(() => {
    setMyReview(null);
    setSummary(null);
    setSummaryError(false);
    summaryLoadedKeyRef.current = '';
    if (!hasWork) return;

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
  };
}
