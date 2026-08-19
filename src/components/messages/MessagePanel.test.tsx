import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import MessagePanel from '@/components/messages/MessagePanel';
import { UserMessagePage } from '@/lib/message-types';

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
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
    expect(screen.getByText('已从 1 集更新至 2 集')).toBeInTheDocument();

    fireEvent.click(screen.getByText('测试剧集'));
    expect(props.onRead).toHaveBeenCalledWith(messagePage.items[1], true);

    fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
    expect(props.onReadAll).toHaveBeenCalledTimes(1);
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
