import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import MessagePanel from '@/components/messages/MessagePanel';
import { UserMessage, UserMessagePage } from '@/lib/message-types';
import {
  fetchMessageSettings,
  getAnnouncementHistoryPage,
  saveMessageSettings,
} from '@/lib/messages.client';
import { fetchPublicReview } from '@/lib/video-reviews.client';

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', profileId: 'profileMe' },
  }),
}));
jest.mock('@/components/PublicReviewContent', () => ({
  __esModule: true,
  default: ({
    review,
    isMine,
    defaultRepliesExpanded,
    highlightReplyId,
  }: {
    review: { content: string };
    isMine: boolean;
    defaultRepliesExpanded?: boolean;
    highlightReplyId?: string;
  }) => (
    <div
      data-testid='review'
      data-mine={String(isMine)}
      data-expanded={String(Boolean(defaultRepliesExpanded))}
      data-highlight={highlightReplyId ?? ''}
    >
      {review.content}
    </div>
  ),
}));
jest.mock('@/lib/video-reviews.client', () => ({
  fetchPublicReview: jest.fn(),
}));
jest.mock('@/lib/messages.client', () => ({
  fetchMessageSettings: jest.fn(),
  getAnnouncementHistoryPage: jest.fn(),
  saveMessageSettings: jest.fn(),
}));
jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({ announcement: '本站仅提供信息检索' }),
}));

const messagePage: UserMessagePage = {
  items: [
    {
      id: 'announcement:v1',
      type: 'announcement',
      content: '测试公告内容',
      createdAt: Date.now(),
    },
    {
      id: 'tracking:source:video:1:2',
      type: 'tracking-update',
      recordKey: 'source+video',
      source: 'source',
      videoId: 'video',
      title: '测试剧集',
      year: '2024',
      sourceName: '测试源站',
      cover: '/cover.webp',
      fromEpisodes: 1,
      toEpisodes: 2,
      createdAt: Date.now(),
    },
  ],
  total: 2,
  nextCursor: null,
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof MessagePanel>> = {},
) {
  const props: React.ComponentProps<typeof MessagePanel> = {
    open: true,
    page: messagePage,
    loading: false,
    loadingMore: false,
    loadError: null,
    workingIds: new Set(),
    onClose: jest.fn(),
    onRead: jest.fn().mockResolvedValue(undefined),
    onReadAll: jest.fn().mockResolvedValue(undefined),
    onLoadMore: jest.fn().mockResolvedValue(undefined),
    onRetry: jest.fn().mockResolvedValue(undefined),
    onSettingsSaved: jest.fn(),
    ...overrides,
  };
  render(<MessagePanel {...props} />);
  return props;
}

describe('MessagePanel', () => {
  it('分组显示公告和追更更新，并触发对应已读操作', () => {
    const props = renderPanel();

    expect(
      screen.getByRole('dialog', { name: '我的消息' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '公告' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '追更更新' }),
    ).toBeInTheDocument();
    expect(screen.getByText('测试公告内容')).toBeInTheDocument();
    expect(screen.queryByText('站点公告')).not.toBeInTheDocument();
    expect(screen.getByText('已从 1 集更新至 2 集')).toBeInTheDocument();

    const readButtons = screen.getAllByRole('button', { name: '标记为已读' });
    expect(readButtons).toHaveLength(2);
    fireEvent.click(readButtons[1]);
    expect(props.onRead).toHaveBeenCalledWith(messagePage.items[1]);

    fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
    expect(props.onReadAll).toHaveBeenCalledTimes(1);
  });

  it('消息标题与封面不可点击，只保留通知展示', () => {
    const props = renderPanel();

    fireEvent.click(screen.getByText('测试剧集'));
    fireEvent.click(screen.getByText('已从 1 集更新至 2 集'));
    fireEvent.click(screen.getByLabelText('测试剧集'));

    expect(props.onRead).not.toHaveBeenCalled();
  });

  it('追更消息的去观看入口跳转播放页并关闭面板', () => {
    const props = renderPanel();

    const link = screen.getByRole('link', { name: '去观看《测试剧集》' });
    expect(link).toHaveAttribute(
      'href',
      `/play?${new URLSearchParams({ source: 'source', id: 'video', title: '测试剧集', year: '2024' })}`,
    );
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onRead).not.toHaveBeenCalled();
  });

  it('加载失败时提供重试操作', () => {
    const onRetry = jest.fn().mockResolvedValue(undefined);
    renderPanel({
      page: { items: [], total: 0, nextCursor: null },
      loadError: '请检查网络连接后重试',
      onRetry,
    });

    expect(screen.getByText('消息加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('打开时锁定页面滚动，并支持 Escape 关闭', async () => {
    const onClose = jest.fn();
    const { unmount } = render(
      <MessagePanel
        open
        page={{ items: [], total: 0, nextCursor: null }}
        loading={false}
        loadingMore={false}
        loadError={null}
        workingIds={new Set()}
        onClose={onClose}
        onRead={jest.fn().mockResolvedValue(undefined)}
        onReadAll={jest.fn().mockResolvedValue(undefined)}
        onLoadMore={jest.fn().mockResolvedValue(undefined)}
        onRetry={jest.fn().mockResolvedValue(undefined)}
        onSettingsSaved={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });
});

const reviewTarget = {
  profileId: 'profileAlice',
  title_norm: '三体',
  year: '2023',
};
const alice = {
  profileId: 'profileAlice',
  avatarSeed: null,
  nickname: '爱丽丝',
};
const bob = { profileId: 'profileBob', avatarSeed: null, nickname: '鲍勃' };
const followReview: UserMessage = {
  id: 'follow:1',
  type: 'follow-review',
  review: reviewTarget,
  author: alice,
  title: '三体',
  year: '2023',
  cover: '',
  rating: 8,
  createdAt: 1,
};
const publicReview = {
  author: alice,
  title_norm: '三体',
  title: '三体',
  year: '2023',
  cover: '',
  rating: 8,
  content: '值得一看',
  spoiler: false,
  likeCount: 0,
  likedByMe: false,
  replyCount: 0,
  created_at: 1,
  updated_at: 1,
};

function pageOf(...items: UserMessage[]): UserMessagePage {
  return { items, total: items.length, nextCursor: null };
}

it('点开评价类消息在面板内显示评价详情并标记已读，可返回列表', async () => {
  jest.mocked(fetchPublicReview).mockResolvedValue(publicReview);
  const props = renderPanel({ page: pageOf(followReview) });
  expect(screen.getByText('评价了《三体》')).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /爱丽丝/ }));
  });

  expect(props.onRead).toHaveBeenCalledWith(followReview);
  expect(fetchPublicReview).toHaveBeenCalledWith(reviewTarget);
  expect(screen.getByRole('heading', { name: '评价详情' })).toBeInTheDocument();
  expect(screen.getByTestId('review')).toHaveTextContent('值得一看');
  expect(screen.getByTestId('review')).toHaveAttribute('data-mine', 'false');
  expect(screen.getByRole('link', { name: '在播放页查看' })).toHaveAttribute(
    'href',
    `/play?${new URLSearchParams({ title: '三体', year: '2023', tab: 'reviews' })}`,
  );

  fireEvent.click(screen.getByRole('button', { name: '返回消息列表' }));
  expect(screen.getByRole('heading', { name: '我的消息' })).toBeInTheDocument();
});

it('回复消息的评价详情展开回复并高亮该条回复', async () => {
  jest.mocked(fetchPublicReview).mockResolvedValue(publicReview);
  renderPanel({
    page: pageOf({
      id: 'review-reply:1',
      type: 'review-reply',
      review: reviewTarget,
      replyId: 'reply-1',
      author: bob,
      title: '三体',
      year: '2023',
      cover: '',
      content: '同意',
      createdAt: 1,
    }),
  });
  expect(screen.getByText('在《三体》中回复了你')).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /鲍勃/ }));
  });

  expect(screen.getByTestId('review')).toHaveAttribute('data-expanded', 'true');
  expect(screen.getByTestId('review')).toHaveAttribute(
    'data-highlight',
    'reply-1',
  );
});

it('评价已删除或转为私密时提示不可查看', async () => {
  jest.mocked(fetchPublicReview).mockResolvedValue(null);
  renderPanel({ page: pageOf(followReview) });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /爱丽丝/ }));
  });
  expect(
    screen.getByText('这条评价已删除或设为仅自己可见'),
  ).toBeInTheDocument();
});

it('新粉丝消息链接对方主页，点赞消息合并显示人数', () => {
  renderPanel({
    page: pageOf(
      {
        id: 'new-follower:1',
        type: 'new-follower',
        follower: bob,
        createdAt: 1,
      },
      {
        id: 'review-like:1',
        type: 'review-like',
        latestLiker: alice,
        likeCount: 3,
        review: reviewTarget,
        title: '三体',
        year: '2023',
        cover: '',
        createdAt: 1,
      },
    ),
  });
  expect(screen.getByRole('link', { name: /鲍勃/ })).toHaveAttribute(
    'href',
    '/u/profileBob',
  );
  expect(screen.getByText('关注了你')).toBeInTheDocument();
  expect(screen.getByText('等 3 人赞了你对《三体》的评价')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: '追更与互动' }),
  ).toBeInTheDocument();
});

it('通知设置按类型开关并保存，保存后通知刷新列表', async () => {
  jest
    .mocked(fetchMessageSettings)
    .mockResolvedValue({ mutedKinds: ['review-like'] });
  jest
    .mocked(saveMessageSettings)
    .mockResolvedValue({ mutedKinds: ['review-like', 'new-follower'] });
  const props = renderPanel();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '通知设置' }));
  });
  expect(screen.getByRole('switch', { name: '评价被点赞' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const follower = screen.getByRole('switch', { name: '新粉丝' });
  expect(follower).toHaveAttribute('aria-checked', 'true');

  await act(async () => {
    fireEvent.click(follower);
  });
  expect(saveMessageSettings).toHaveBeenCalledWith([
    'review-like',
    'new-follower',
  ]);
  expect(follower).toHaveAttribute('aria-checked', 'false');
  expect(props.onSettingsSaved).toHaveBeenCalledTimes(1);
});

it('保存失败时提示并恢复为服务端设置', async () => {
  jest.mocked(fetchMessageSettings).mockResolvedValue({ mutedKinds: [] });
  jest.mocked(saveMessageSettings).mockRejectedValue(new Error('HTTP 500'));
  renderPanel();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '通知设置' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: '追更更新' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('保存失败，请重试');
  expect(screen.getByRole('switch', { name: '追更更新' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

it('子视图中 Escape 先返回列表，再次 Escape 才关闭面板', async () => {
  jest.mocked(fetchMessageSettings).mockResolvedValue({ mutedKinds: [] });
  const props = renderPanel();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '通知设置' }));
  });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: '我的消息' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('同一批次内连续切换多个开关时按最新状态提交', async () => {
  jest.mocked(fetchMessageSettings).mockResolvedValue({ mutedKinds: [] });
  jest
    .mocked(saveMessageSettings)
    .mockImplementation(async (mutedKinds) => ({ mutedKinds }));
  renderPanel();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '通知设置' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: '新粉丝' }));
    fireEvent.click(screen.getByRole('switch', { name: '评价被点赞' }));
  });
  expect(saveMessageSettings).toHaveBeenLastCalledWith([
    'new-follower',
    'review-like',
  ]);
  expect(screen.getByRole('switch', { name: '新粉丝' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

it('公告视图显示站点须知与历史公告，可加载更多', async () => {
  const history = jest.mocked(getAnnouncementHistoryPage);
  history
    .mockResolvedValueOnce({
      items: [
        {
          id: 'announcement:2000:b',
          type: 'announcement',
          content: '新增弹幕功能',
          createdAt: 2_000,
        },
      ],
      nextCursor: '2000:b',
    })
    .mockResolvedValueOnce({
      items: [
        {
          id: 'announcement:1000:a',
          type: 'announcement',
          content: '首次上线',
          createdAt: 1_000,
        },
      ],
      nextCursor: null,
    });
  renderPanel();

  fireEvent.click(screen.getByRole('button', { name: '查看公告' }));
  expect(screen.getByRole('heading', { name: '公告' })).toBeInTheDocument();
  expect(screen.getByText('本站仅提供信息检索')).toBeInTheDocument();
  expect(await screen.findByText('新增弹幕功能')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  expect(await screen.findByText('首次上线')).toBeInTheDocument();
  expect(history).toHaveBeenLastCalledWith('2000:b');
  expect(
    screen.queryByRole('button', { name: '加载更多' }),
  ).not.toBeInTheDocument();
});
