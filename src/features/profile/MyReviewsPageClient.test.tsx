import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import MyReviewsPageClient from '@/features/profile/MyReviewsPageClient';
import type { VideoReview } from '@/lib/types';
import {
  deleteVideoReview,
  fetchMyVideoReviews,
} from '@/lib/video-reviews.client';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role='img' aria-label={alt} />,
}));
jest.mock('@/lib/video-reviews.client', () => ({
  fetchMyVideoReviews: jest.fn(),
  deleteVideoReview: jest.fn(),
}));
const review: VideoReview = {
  title_norm: '三体',
  title: '三体',
  year: '2023',
  cover: '',
  douban_id: 0,
  rating: 8,
  content: '值得一看',
  is_public: true,
  source_key: 'a+1',
  created_at: 1,
  updated_at: 2,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchMyVideoReviews).mockResolvedValue([
    review,
    {
      ...review,
      title_norm: '私密电影',
      title: '私密电影',
      rating: null,
      is_public: false,
    },
  ]);
  jest.mocked(deleteVideoReview).mockResolvedValue(undefined);
});
it('显示私密评价并用源标识跳转，筛选仅文字与搜索', async () => {
  render(<MyReviewsPageClient />);
  expect(await screen.findByRole('link', { name: '播放三体' })).toHaveAttribute(
    'href',
    '/play?title=%E4%B8%89%E4%BD%93&year=2023&source=a&id=1',
  );
  expect(screen.getByText('私密', { selector: 'span' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^仅文字/ }));
  expect(
    screen.queryByRole('link', { name: '播放三体' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: '播放私密电影' }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索我的评价' }), {
    target: { value: '未命中' },
  });
  expect(screen.getByText('暂无符合条件的评价')).toBeInTheDocument();
});
it('删除前确认，确认后仅移除目标作品', async () => {
  render(<MyReviewsPageClient />);
  fireEvent.click(
    await screen.findByRole('button', { name: '删除对三体的评价' }),
  );
  expect(deleteVideoReview).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  });
  expect(deleteVideoReview).toHaveBeenCalledWith('三体', '2023', '三体');
  expect(
    screen.queryByRole('link', { name: '播放三体' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: '播放私密电影' }),
  ).toBeInTheDocument();
});
