import { act, render, screen, waitFor } from '@testing-library/react';

import {
  readNotifiedMessageAt,
  writeNotifiedMessageAt,
} from '@/lib/message-notification-preference';
import type { UserMessagePage, UserMessageSummary } from '@/lib/message-types';
import { dismissToast, showToast } from '@/lib/toast';

const mockGetMessageSummary = jest.fn();
const mockGetMessagePage = jest.fn();
const mockReadMessage = jest.fn();
const mockReadAllMessages = jest.fn();
const mockLoadPanel = jest.fn();

jest.mock('next/dynamic', () => {
  const dynamic = jest.requireActual('next/dynamic').default;
  return {
    __esModule: true,
    default: (loader: () => Promise<unknown>, options: unknown) =>
      dynamic(() => {
        mockLoadPanel();
        return loader();
      }, options),
  };
});

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', username: 'demo' },
  }),
}));

jest.mock('@/lib/messages.client', () => ({
  getMessageSummary: (...args: unknown[]) => mockGetMessageSummary(...args),
  getMessagePage: (...args: unknown[]) => mockGetMessagePage(...args),
  readMessage: (...args: unknown[]) => mockReadMessage(...args),
  readAllMessages: (...args: unknown[]) => mockReadAllMessages(...args),
}));

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

jest.mock('@/components/messages/MessagePanel', () => ({
  __esModule: true,
  default: ({
    open,
    page,
    onRead,
    onReadAll,
    onClose,
  }: {
    open: boolean;
    page: UserMessagePage;
    onRead: (message: UserMessagePage['items'][number]) => void;
    onReadAll: () => void;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid='panel'>
        <button data-testid='close-panel' onClick={onClose}>
          close
        </button>
        <span data-testid='panel-total'>{page.total}</span>
        {page.items.map((item) => (
          <button
            key={item.id}
            data-testid={`read-${item.id}`}
            onClick={() => onRead(item)}
          >
            {item.id}
          </button>
        ))}
        <button data-testid='read-all' onClick={() => onReadAll()}>
          all
        </button>
      </div>
    ) : null,
}));

import {
  MessageCenterProvider,
  useMessageCenter,
} from '@/components/messages/MessageCenterProvider';

function summaryOf(revision: string, unreadCount: number): UserMessageSummary {
  return {
    latestUnreadAt: unreadCount ? Number(revision.split('-')[1]) * 1000 : 0,
    latestUnread: unreadCount
      ? {
          type: 'tracking-update',
          title: '测试剧集',
          toEpisodes: 2,
          createdAt: 1000,
        }
      : null,
    unreadCount,
    trackingUnreadCount: unreadCount,
    reviewReplyUnreadCount: 0,
    newFollowerUnreadCount: 0,
    reviewLikeUnreadCount: 0,
    followReviewUnreadCount: 0,
    revision,
    announcement: null,
    latestTracking: {
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
      createdAt: 1000,
    },
  };
}

function pageOf(total: number): UserMessagePage {
  return {
    items: [
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
        createdAt: 1000,
      },
    ],
    total,
    nextCursor: null,
  };
}

function Harness() {
  const { unreadCount, trackingUnreadCount, openPanel } = useMessageCenter();
  return (
    <div>
      <span data-testid='unread'>{unreadCount}</span>
      <span data-testid='tracking-unread'>{String(trackingUnreadCount)}</span>
      <button data-testid='open' onClick={openPanel}>
        open
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <MessageCenterProvider>
      <Harness />
    </MessageCenterProvider>,
  );
}

describe('MessageCenterProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.localStorage.clear();
    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-1', 1));
    mockGetMessagePage.mockResolvedValue(pageOf(1));
    mockReadMessage.mockResolvedValue({});
    mockReadAllMessages.mockResolvedValue({ updatedRecords: {} });
  });

  it('loads the panel only on first open and reuses it after closing', async () => {
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalled());
    expect(mockLoadPanel).not.toHaveBeenCalled();

    await act(async () => screen.getByTestId('open').click());
    await screen.findByTestId('panel');
    expect(mockLoadPanel).toHaveBeenCalledTimes(1);

    await act(async () => screen.getByTestId('close-panel').click());
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
    await act(async () => screen.getByTestId('open').click());
    await screen.findByTestId('panel');
    expect(mockLoadPanel).toHaveBeenCalledTimes(1);
  });

  it('revision 改变但事件时间未推进时只更新角标', async () => {
    renderProvider();
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    mockGetMessageSummary.mockResolvedValue({
      ...summaryOf('rev-2', 2),
      latestUnreadAt: 1000,
    });
    window.dispatchEvent(new CustomEvent('messagesUpdated'));
    await waitFor(() =>
      expect(screen.getByTestId('unread')).toHaveTextContent('2'),
    );
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('未读数量下降仍提醒时间更新的事件，固定 key 原地更新', async () => {
    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-1', 3));
    renderProvider();
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-2', 1));
    window.dispatchEvent(new CustomEvent('messagesUpdated'));
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(2));
    expect(
      jest
        .mocked(showToast)
        .mock.calls.every((call) => call[2]?.key === 'messages'),
    ).toBe(true);
  });

  it('无焦点时保留待提醒事件，焦点恢复后提醒；重挂载共享水位', async () => {
    jest.mocked(document.hasFocus).mockReturnValue(false);
    const view = renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('unread')).toHaveTextContent('1'),
    );
    expect(showToast).not.toHaveBeenCalled();
    jest.mocked(document.hasFocus).mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(showToast).toHaveBeenCalledTimes(1);
    view.unmount();
    const calls = mockGetMessageSummary.mock.calls.length;
    renderProvider();
    await waitFor(() =>
      expect(mockGetMessageSummary).toHaveBeenCalledTimes(calls + 1),
    );
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('隐藏页面不提醒，另一个标签页推进水位后不重复提醒', async () => {
    const visible = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('unread')).toHaveTextContent('1'),
    );
    expect(showToast).not.toHaveBeenCalled();
    writeNotifiedMessageAt('demo', 1000);
    visible.mockReturnValue('visible');
    await act(async () =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    expect(showToast).not.toHaveBeenCalled();
    visible.mockRestore();
  });

  it('面板打开时推进提醒时间，关闭和重挂载后不补弹', async () => {
    const view = renderProvider();
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    await act(async () => screen.getByTestId('open').click());
    await screen.findByTestId('panel');
    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-2', 2));
    window.dispatchEvent(new CustomEvent('messagesUpdated'));
    await waitFor(() =>
      expect(screen.getByTestId('unread')).toHaveTextContent('2'),
    );
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(readNotifiedMessageAt('demo')).toBe(2000);
    view.unmount();
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalledTimes(3));
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('挂载后暴露未读数并弹出提示', async () => {
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId('unread').textContent).toBe('1'),
    );
    expect(screen.getByTestId('tracking-unread').textContent).toBe('1');
    expect(showToast).toHaveBeenCalledWith(
      '《测试剧集》已更新至第 2 集',
      'notice',
      expect.objectContaining({ key: 'messages' }),
    );
  });

  it('消息提示的查看操作打开面板并收起提示', async () => {
    renderProvider();
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    const options = jest.mocked(showToast).mock.calls[0][2];

    await act(async () => options?.action?.onClick());

    await screen.findByTestId('panel');
    expect(dismissToast).toHaveBeenCalledWith('messages');
  });

  it('面板打开时轮询到新 revision 会重载首页', async () => {
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId('open').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('panel')).toBeInTheDocument(),
    );
    expect(mockGetMessagePage).toHaveBeenCalledTimes(1);

    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-2', 2));
    mockGetMessagePage.mockResolvedValue(pageOf(2));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('messagesUpdated'));
    });

    await waitFor(() => expect(mockGetMessagePage).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('panel-total').textContent).toBe('2');
  });

  it('面板关闭时不因 revision 变化重载首页', async () => {
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalled());

    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-2', 2));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('messagesUpdated'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('unread').textContent).toBe('2'),
    );
    expect(mockGetMessagePage).not.toHaveBeenCalled();
  });

  it('已读后本地刷新摘要且不重载首页', async () => {
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalled());
    await act(async () => {
      screen.getByTestId('open').click();
    });
    await waitFor(() => expect(mockGetMessagePage).toHaveBeenCalledTimes(1));

    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-2', 0));
    await act(async () => {
      screen.getByTestId('read-tracking:source:video:1:2').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('unread').textContent).toBe('0'),
    );
    expect(mockGetMessagePage).toHaveBeenCalledTimes(1);
  });

  it('已读追更消息后不跳转播放页', async () => {
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalled());
    await act(async () => {
      screen.getByTestId('open').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('panel')).toBeInTheDocument(),
    );

    await act(async () => {
      screen.getByTestId('read-tracking:source:video:1:2').click();
    });

    await waitFor(() => expect(mockReadMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('标记已读失败时保留未读数', async () => {
    mockReadMessage.mockRejectedValue(new Error('boom'));
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    renderProvider();
    await waitFor(() => expect(mockGetMessageSummary).toHaveBeenCalled());
    await act(async () => {
      screen.getByTestId('open').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('panel')).toBeInTheDocument(),
    );

    await act(async () => {
      screen.getByTestId('read-tracking:source:video:1:2').click();
    });

    expect(screen.getByTestId('unread').textContent).toBe('1');
    consoleError.mockRestore();
  });
});
