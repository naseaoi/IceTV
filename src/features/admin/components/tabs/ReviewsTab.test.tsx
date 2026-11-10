import { act, fireEvent, render, screen, within } from '@testing-library/react';

import ReviewsTab from '@/features/admin/components/tabs/ReviewsTab';
import { getAdminReviewReports } from '@/features/admin/lib/api';
import { showToast } from '@/lib/toast';
import { type AdminVideoReview } from '@/lib/types';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

jest.mock('@/features/admin/lib/api', () => ({
  ...jest.requireActual('@/features/admin/lib/api'),
  getAdminReviewReports: jest.fn(),
}));

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role='img' aria-label={alt} />,
}));

const review: AdminVideoReview = {
  username: 'alice',
  author: { profileId: 'profileAlice', avatarSeed: null, nickname: '爱丽丝' },
  spoiler: false,
  replyCount: 0,
  likeCount: 0,
  likedByMe: false,
  title_norm: '测试电影',
  title: '测试电影',
  year: '2026',
  cover: 'https://example.com/cover.jpg',
  rating: 9,
  content: '值得一看',
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

function response(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

async function tick(milliseconds = 0) {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

const originalFetch = global.fetch;
const fetchMock = jest.fn();

describe('ReviewsTab', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest
      .mocked(getAdminReviewReports)
      .mockResolvedValue({ items: [], nextCursor: null, pendingTotal: 0 });
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      response({ items: [review], nextCursor: null }),
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('loads reviews and renders metadata, unrated items and collapsible content', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        items: [
          review,
          {
            ...review,
            username: 'bob',
            rating: null,
            content: '长评价'.repeat(70),
          },
        ],
        nextCursor: null,
      }),
    );
    render(<ReviewsTab />);
    expect(screen.getByRole('status')).toHaveTextContent('加载中');
    await tick();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/reviews', {
      cache: 'no-store',
    });
    expect(screen.getAllByText('(2026)')).toHaveLength(2);
    expect(screen.getByText('爱丽丝（alice）')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: '9.0 分（满分 10 分）' }),
    ).toBeInTheDocument();
    expect(screen.getByText('未评分')).toBeInTheDocument();
    expect(screen.getAllByText(/更新于/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }));
    expect(screen.getByRole('button', { name: '收起评价' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('debounces search and resets cursor pagination', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ items: [review], nextCursor: 'cursor/+=1' }),
    );
    render(<ReviewsTab />);
    await tick();
    fetchMock.mockResolvedValueOnce(
      response({ items: [{ ...review, username: 'bob' }], nextCursor: null }),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await tick();
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/admin/reviews?cursor=cursor%2F%2B%3D1',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '测试' },
    });
    await tick(200);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'alice' },
    });
    await tick(299);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/admin/reviews?q=alice');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('ignores stale search responses', async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    );
    render(<ReviewsTab />);
    await tick();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'bob' },
    });
    fetchMock.mockResolvedValueOnce(
      response({ items: [{ ...review, username: 'bob' }], nextCursor: null }),
    );
    await tick(300);
    await act(async () => {
      resolveOld(response({ items: [review], nextCursor: 'old' }));
    });
    expect(screen.getByText('爱丽丝（bob）')).toBeInTheDocument();
    expect(screen.queryByText('爱丽丝（alice）')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '加载更多' }),
    ).not.toBeInTheDocument();
  });

  it('confirms deletion and removes only the matching composite key locally', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        items: [review, { ...review, year: '2025' }],
        nextCursor: null,
      }),
    );
    render(<ReviewsTab />);
    await tick();
    const first = screen.getAllByRole('listitem')[0];
    fireEvent.click(within(first).getByRole('button', { name: /删除/ }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(first).getByRole('button', { name: /删除/ }));
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await tick();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/reviews', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        title_norm: '测试电影',
        year: '2026',
      }),
    });
    expect(screen.queryByText('(2026)')).not.toBeInTheDocument();
    expect(screen.getByText('(2025)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the row and displays server errors when deletion fails', async () => {
    render(<ReviewsTab />);
    await tick();
    fireEvent.click(screen.getByRole('button', { name: /删除 alice/ }));
    fetchMock.mockResolvedValueOnce(response({ error: '权限不足' }, false));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await tick();
    expect(showToast).toHaveBeenCalledWith('权限不足', 'error');
    expect(screen.getByText('值得一看')).toBeInTheDocument();
  });

  it('keeps deleted rows out of a late pagination response', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ items: [review], nextCursor: 'next' }),
    );
    render(<ReviewsTab />);
    await tick();
    let resolvePage!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePage = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    fireEvent.click(screen.getByRole('button', { name: /删除 alice/ }));
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await tick();
    await act(async () => {
      resolvePage(
        response({
          items: [review, { ...review, username: 'bob' }],
          nextCursor: null,
        }),
      );
    });
    expect(screen.queryByText('爱丽丝（alice）')).not.toBeInTheDocument();
    expect(screen.getByText('爱丽丝（bob）')).toBeInTheDocument();
  });

  it('retries the same search cursor without discarding existing rows', async () => {
    render(<ReviewsTab />);
    await tick();
    fetchMock.mockResolvedValueOnce(
      response({ items: [review], nextCursor: 'next' }),
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '测试' },
    });
    await tick(300);
    fetchMock.mockResolvedValueOnce(response({ error: '加载暂时失败' }, false));
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await tick();
    expect(screen.getByText('值得一看')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(
      response({ items: [{ ...review, username: 'bob' }], nextCursor: null }),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await tick();
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/admin/reviews?q=%E6%B5%8B%E8%AF%95&cursor=next',
    );
    expect(fetchMock.mock.calls[3][0]).toBe(fetchMock.mock.calls[2][0]);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('supports retry after loading errors and shows empty results', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<ReviewsTab />);
    await tick();
    expect(
      screen.getByText('网络连接失败，请检查网络后重试'),
    ).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response({ items: [], nextCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await tick();
    expect(screen.getByText('暂无公开评价')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '未命中' },
    });
    fetchMock.mockResolvedValueOnce(response({ items: [], nextCursor: null }));
    await tick(300);
    expect(screen.getByText('暂无匹配的公开评价')).toBeInTheDocument();
  });
  it.each(['驳回举报', '标为剧透', '删除评价'])(
    '举报操作 %s 先确认再处理',
    async (label) => {
      jest.mocked(getAdminReviewReports).mockResolvedValue({
        items: [
          {
            review,
            reportCount: 2,
            reasons: { spam: 2 },
            reports: [
              {
                reporter: {
                  profileId: 'profileBob00',
                  avatarSeed: null,
                  nickname: '鲍勃',
                },
                reason: 'spam',
                detail: '重复广告',
                created_at: 1,
              },
            ],
            latestReportedAt: 1,
          },
        ],
        nextCursor: null,
        pendingTotal: 1,
      });
      render(<ReviewsTab />);
      await tick();
      fireEvent.click(screen.getByRole('tab', { name: '举报待处理 (1)' }));
      await tick();
      expect(screen.getByText('重复广告')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(
        fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST'),
      ).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: '确认处理' }));
      await tick();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/reviews/reports',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action:
              label === '驳回举报'
                ? 'dismiss'
                : label === '标为剧透'
                  ? 'mark-spoiler'
                  : 'delete-review',
            username: 'alice',
            title_norm: '测试电影',
            year: '2026',
          }),
        }),
      );
    },
  );
});
