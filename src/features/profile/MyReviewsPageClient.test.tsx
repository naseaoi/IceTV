import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import MyReviewsPageClient from '@/features/profile/MyReviewsPageClient';
import { PROFILE_REQUIRED_EVENT } from '@/lib/profile.client';
import type { VideoReview } from '@/lib/types';
import { VIDEO_REVIEWS_UPDATED_EVENT } from '@/lib/video-reviews';
import {
  deleteVideoReview,
  fetchMyVideoReviews,
} from '@/lib/video-reviews.client';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({ session: { status: 'guest' } }),
}));

jest.mock('@/components/card-actions/useMediaCardMenu', () => ({
  useMediaCardMenu: () => ({}),
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
  ...jest.requireActual('@/lib/video-reviews.client'),
  fetchMyVideoReviews: jest.fn(),
  fetchMyVideoReview: jest.fn(),
  deleteVideoReview: jest.fn(),
}));
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
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
      (item) =>
        (query.filter !== 'text' || item.rating === null) &&
        (query.filter !== 'public' || item.is_public) &&
        (query.filter !== 'private' || !item.is_public),
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
      expect.any(AbortSignal),
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
it('切换筛选重新查询期间保留胶囊计数', async () => {
  render(<MyReviewsPageClient />);
  await screen.findByRole('link', { name: '播放三体' });

  let resolvePage: () => void = () => undefined;
  const implementation = jest
    .mocked(fetchMyVideoReviews)
    .getMockImplementation();
  jest.mocked(fetchMyVideoReviews).mockImplementationOnce(
    (query) =>
      new Promise((resolve) => {
        resolvePage = () => resolve(implementation!(query));
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^私密/ }));

  expect(screen.getByRole('button', { name: /^全部/ })).toHaveTextContent(
    '全部2',
  );
  expect(screen.getByRole('button', { name: /^私密/ })).toHaveTextContent(
    '私密1',
  );
  await act(async () => resolvePage());
});
it('切换筛选保留旧列表直到新结果到达，计数为 0 时直接显示空状态', async () => {
  const { container } = render(<MyReviewsPageClient />);
  await screen.findByRole('link', { name: '播放三体' });
  const implementation = jest
    .mocked(fetchMyVideoReviews)
    .getMockImplementation()!;
  let resolvePage: () => void = () => undefined;
  jest.mocked(fetchMyVideoReviews).mockImplementationOnce(
    (query) =>
      new Promise((resolve) => {
        resolvePage = () => resolve(implementation(query));
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^私密/ }));
  expect(container.querySelector('.skeleton')).toBeNull();
  expect(screen.getByRole('link', { name: '播放三体' })).toBeInTheDocument();
  expect(container.querySelector('[aria-busy="true"]')).toHaveAttribute(
    'inert',
  );
  await act(async () => resolvePage());
  expect(screen.queryByRole('link', { name: '播放三体' })).toBeNull();
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();

  records = [review];
  act(() => {
    window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT));
  });
  fireEvent.click(screen.getByRole('button', { name: /^全部/ }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^私密/ })).toHaveTextContent(
      '私密0',
    ),
  );
  jest
    .mocked(fetchMyVideoReviews)
    .mockReturnValueOnce(new Promise(() => undefined));
  fireEvent.click(screen.getByRole('button', { name: /^私密/ }));
  expect(screen.getByText('暂无符合条件的评价')).toBeInTheDocument();
  expect(container.querySelector('.skeleton')).toBeNull();
  expect(screen.queryByText(/条评价/)).toBeNull();
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
    expect.any(AbortSignal),
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

it('编辑后就地更新卡片并派发更新事件，保留其他卡片', async () => {
  const updated = {
    ...review,
    rating: 9.1,
    content: '新的感受',
    is_public: false,
    spoiler: true,
    updated_at: 3,
  };
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ review: updated }) });
  const listener = jest.fn();
  window.addEventListener(VIDEO_REVIEWS_UPDATED_EVENT, listener);
  try {
    render(<MyReviewsPageClient />);
    fireEvent.click(
      await screen.findByRole('button', { name: '编辑对三体的评价' }),
    );
    expect(screen.getByLabelText('评价全文')).toHaveValue('值得一看');
    fireEvent.change(screen.getByLabelText('评价全文'), {
      target: { value: '新的感受' },
    });
    fireEvent.change(screen.getByLabelText('分数（1.0–10.0）'), {
      target: { value: '9.1' },
    });
    fireEvent.blur(screen.getByLabelText('分数（1.0–10.0）'));
    fireEvent.click(screen.getByRole('button', { name: '评价设置' }));
    fireEvent.click(screen.getByRole('switch', { name: '公开评价' }));
    fireEvent.click(screen.getByRole('switch', { name: '包含剧透' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/reviews',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          title: review.title,
          year: review.year,
          cover: review.cover,
          douban_id: review.douban_id,
          source_key: review.source_key,
          rating: 9.1,
          content: '新的感受',
          is_public: false,
          spoiler: true,
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('新的感受')).toBeInTheDocument();
    expect(screen.getByText('9.1')).toBeInTheDocument();
    expect(screen.getByText('包含剧透')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '播放私密电影' }),
    ).toBeInTheDocument();
    expect(fetchMyVideoReviews).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(VIDEO_REVIEWS_UPDATED_EVENT, listener);
  }
});

it('保存失败保留草稿，缺少昵称复用统一事件，随后可以重试', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ code: 'NICKNAME_REQUIRED', error: '请先设置昵称' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ review: { ...review, content: '保留草稿' } }),
    });
  const listener = jest.fn();
  window.addEventListener(PROFILE_REQUIRED_EVENT, listener);
  try {
    render(<MyReviewsPageClient />);
    fireEvent.click(
      await screen.findByRole('button', { name: '编辑对三体的评价' }),
    );
    fireEvent.change(screen.getByLabelText('评价全文'), {
      target: { value: '保留草稿' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByLabelText('评价全文')).toHaveValue('保留草稿');
    expect(listener).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('保留草稿')).toBeInTheDocument();
  } finally {
    window.removeEventListener(PROFILE_REQUIRED_EVENT, listener);
  }
});

it('取消编辑保持原评价，文字筛选中添加评分后移出卡片', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ review: { ...records[1], rating: 10 } }),
  });
  render(<MyReviewsPageClient />);
  fireEvent.click(
    await screen.findByRole('button', { name: '编辑对三体的评价' }),
  );
  fireEvent.change(screen.getByLabelText('评价全文'), {
    target: { value: '未保存' },
  });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').closest('.motion-dialog')).toHaveAttribute(
    'data-open',
    'false',
  );
  expect(screen.getByLabelText('评价全文')).toHaveValue('未保存');
  fireEvent.click(screen.getByRole('button', { name: '编辑对三体的评价' }));
  expect(screen.getByLabelText('评价全文')).toHaveValue('值得一看');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getAllByText('值得一看')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /^仅文字/ }));
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: '播放三体' }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑对私密电影的评价' }));
  fireEvent.keyDown(screen.getByRole('slider', { name: '评分' }), {
    key: 'End',
  });
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText('评价全文'), {
      key: 'Enter',
      ctrlKey: true,
    });
  });
  expect(
    screen.queryByRole('link', { name: '播放私密电影' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^仅文字/ })).toHaveTextContent(
    '0',
  );
});

it('切回看过的筛选先显示快照，评价更新后快照失效', async () => {
  const { container } = render(<MyReviewsPageClient />);
  await screen.findByRole('link', { name: '播放三体' });
  fireEvent.click(screen.getByRole('button', { name: /^仅文字/ }));
  await screen.findByRole('link', { name: '播放私密电影' });
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: '播放三体' })).toBeNull(),
  );

  jest
    .mocked(fetchMyVideoReviews)
    .mockReturnValueOnce(new Promise(() => undefined));
  fireEvent.click(screen.getByRole('button', { name: /^全部/ }));
  expect(screen.getByRole('link', { name: '播放三体' })).toBeInTheDocument();
  expect(container.querySelector('.skeleton')).toBeNull();

  act(() => {
    window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT));
  });
  await screen.findByRole('link', { name: '播放三体' });
  await waitFor(() =>
    expect(container.querySelector('[aria-busy="true"]')).toBeNull(),
  );
  jest
    .mocked(fetchMyVideoReviews)
    .mockReturnValueOnce(new Promise(() => undefined));
  fireEvent.click(screen.getByRole('button', { name: /^仅文字/ }));
  // 快照已失效：仍显示旧列表等待新结果，而不是快照里的仅文字结果
  expect(screen.getByRole('link', { name: '播放三体' })).toBeInTheDocument();
  expect(container.querySelector('[aria-busy="true"]')).toHaveAttribute(
    'inert',
  );
});

it('保存时取消旧刷新请求并重新取首页，迟到响应保持新评价', async () => {
  const updated = { ...review, content: '保存后的评价' };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => {
      records = [updated, records[1]];
      return { review: updated };
    },
  });
  render(<MyReviewsPageClient />);
  fireEvent.click(
    await screen.findByRole('button', { name: '编辑对三体的评价' }),
  );
  const implementation = jest
    .mocked(fetchMyVideoReviews)
    .getMockImplementation()!;
  const stalePage = await implementation({});
  let resolveOld!: () => void;
  jest.mocked(fetchMyVideoReviews).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = () => resolve(stalePage);
      }),
  );
  act(() => window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT)));
  const signal = jest.mocked(fetchMyVideoReviews).mock.calls[1][1];
  fireEvent.change(screen.getByLabelText('评价全文'), {
    target: { value: updated.content },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  });
  expect(signal?.aborted).toBe(true);
  expect(fetchMyVideoReviews).toHaveBeenCalledTimes(3);
  expect(
    screen.getByText(updated.content, { selector: 'p' }),
  ).toBeInTheDocument();
  await act(async () => resolveOld());
  expect(
    screen.getByText(updated.content, { selector: 'p' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: '播放私密电影' }),
  ).toBeInTheDocument();
});

it('刷新失败保留评价并通过错误横幅重新加载', async () => {
  render(<MyReviewsPageClient />);
  await screen.findByRole('link', { name: '播放三体' });
  jest
    .mocked(fetchMyVideoReviews)
    .mockRejectedValueOnce(new Error('private diagnostic'));
  act(() => window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT)));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '评价加载失败，请重试',
  );
  expect(screen.getByRole('link', { name: '播放三体' })).toBeInTheDocument();
  expect(screen.queryByText('private diagnostic')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(fetchMyVideoReviews).toHaveBeenCalledTimes(3);
});
