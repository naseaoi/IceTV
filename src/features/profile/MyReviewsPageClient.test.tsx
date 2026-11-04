import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import MyReviewsPageClient from '@/features/profile/MyReviewsPageClient';
import type { VideoReview } from '@/lib/types';
import {
  deleteVideoReview,
  fetchMyVideoReviews,
} from '@/lib/video-reviews.client';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({ session: { status: 'guest' } }),
}));

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
let records: VideoReview[];
beforeEach(() => {
  jest.clearAllMocks();
  records = [
    review,
    {
      ...review,
      title_norm: '私密电影',
      title: '私密电影',
      rating: null,
      is_public: false,
    },
  ];
  jest.mocked(fetchMyVideoReviews).mockImplementation(async (query = {}) => {
    const searched = records.filter(
      (item) => !query.q || `${item.title} ${item.content}`.includes(query.q),
    );
    const items = searched.filter(
      (item) => query.filter !== 'text' || item.rating === null,
    );
    return {
      items,
      nextCursor: null,
      total: records.length,
      counts: {
        all: searched.length,
        public: searched.filter((item) => item.is_public).length,
        private: searched.filter((item) => !item.is_public).length,
        text: searched.filter((item) => item.rating === null).length,
      },
    };
  });
  jest
    .mocked(deleteVideoReview)
    .mockImplementation(async (_title, year, norm) => {
      records = records.filter(
        (item) => item.title_norm !== norm || item.year !== year,
      );
    });
});
it('显示私密评价并用源标识跳转，筛选仅文字与搜索', async () => {
  render(<MyReviewsPageClient />);
  expect(await screen.findByRole('link', { name: '播放三体' })).toHaveAttribute(
    'href',
    '/play?title=%E4%B8%89%E4%BD%93&year=2023&source=a&id=1',
  );
  expect(screen.getByText('私密', { selector: 'span' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^仅文字/ }));
  await waitFor(() =>
    expect(fetchMyVideoReviews).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter: 'text' }),
    ),
  );
  expect(
    await screen.findByRole('link', { name: '播放私密电影' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: '播放三体' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: '播放私密电影' }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索我的评价' }), {
    target: { value: '未命中' },
  });
  expect(await screen.findByText('暂无符合条件的评价')).toBeInTheDocument();
});
it('loads the next server page without replacing the first page', async () => {
  jest
    .mocked(fetchMyVideoReviews)
    .mockResolvedValueOnce({
      items: [review],
      nextCursor: 'next-page',
      total: 2,
      counts: { all: 2, public: 2, private: 0, text: 0 },
    })
    .mockResolvedValueOnce({
      items: [{ ...review, title_norm: '另一部', title: '另一部' }],
      nextCursor: null,
      total: 2,
      counts: { all: 2, public: 2, private: 0, text: 0 },
    });
  render(<MyReviewsPageClient />);
  await screen.findByRole('link', { name: '播放三体' });
  const more = screen.queryByRole('button', { name: '加载更多' });
  if (more) fireEvent.click(more);
  expect(
    await screen.findByRole('link', { name: '播放另一部' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '播放三体' })).toBeInTheDocument();
  expect(fetchMyVideoReviews).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'next-page' }),
  );
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
