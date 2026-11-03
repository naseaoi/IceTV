import { act, renderHook, waitFor } from '@testing-library/react';

import { useVideoReviews } from '@/features/play/hooks/useVideoReviews';
import type { VideoReview } from '@/lib/types';
import {
  fetchMyVideoReview,
  fetchWorkReviewSummary,
  saveVideoReview,
} from '@/lib/video-reviews.client';

jest.mock('@/lib/video-reviews.client', () => ({
  fetchMyVideoReview: jest.fn(),
  fetchWorkReviewSummary: jest.fn(),
  saveVideoReview: jest.fn(),
  deleteVideoReview: jest.fn(),
}));

const mockedFetchMy = jest.mocked(fetchMyVideoReview);
const mockedFetchSummary = jest.mocked(fetchWorkReviewSummary);
const mockedSave = jest.mocked(saveVideoReview);

const review: VideoReview = {
  title_norm: '三体',
  year: '2023',
  title: '三体',
  cover: '',
  douban_id: 0,
  rating: 8,
  content: '',
  is_public: true,
  source_key: 'a+1',
  created_at: 1,
  updated_at: 1,
};

const baseOptions = {
  title: '三体',
  year: '2023',
  cover: '',
  doubanId: 0,
  sourceKey: 'a+1',
  summaryEnabled: false,
};

describe('useVideoReviews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchMy.mockResolvedValue(review);
    mockedFetchSummary.mockResolvedValue({
      distribution: Array(10).fill(0),
      average: 8,
      count: 1,
      reviews: [],
    });
  });

  it('keeps loaded data when switching to a source with the same work identity', async () => {
    const { result, rerender } = renderHook(
      (options) => useVideoReviews(options),
      { initialProps: baseOptions },
    );
    await waitFor(() => expect(result.current.myReview).toEqual(review));

    rerender({ ...baseOptions, title: '三体 ', sourceKey: 'b+9' });
    expect(result.current.myReview).toEqual(review);
    expect(mockedFetchMy).toHaveBeenCalledTimes(1);

    rerender({ ...baseOptions, title: '三体2' });
    await waitFor(() => expect(mockedFetchMy).toHaveBeenCalledTimes(2));
  });

  it('loads the public summary only when enabled and refreshes it after saving', async () => {
    const { result, rerender } = renderHook(
      (options) => useVideoReviews(options),
      { initialProps: baseOptions },
    );
    await waitFor(() => expect(result.current.myReview).toEqual(review));
    expect(mockedFetchSummary).not.toHaveBeenCalled();

    rerender({ ...baseOptions, summaryEnabled: true });
    await waitFor(() => expect(result.current.summary?.count).toBe(1));
    expect(mockedFetchSummary).toHaveBeenCalledTimes(1);

    mockedSave.mockResolvedValue({ ...review, rating: 6 });
    await act(async () => {
      await result.current.save({ rating: 6, content: '', is_public: true });
    });

    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: '三体', source_key: 'a+1', rating: 6 }),
    );
    expect(result.current.myReview?.rating).toBe(6);
    await waitFor(() => expect(mockedFetchSummary).toHaveBeenCalledTimes(2));
  });
});
