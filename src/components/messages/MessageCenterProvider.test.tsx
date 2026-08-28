import { act, render, screen, waitFor } from '@testing-library/react';

import type { UserMessagePage, UserMessageSummary } from '@/lib/message-types';

const mockGetMessageSummary = jest.fn();
const mockGetMessagePage = jest.fn();
const mockReadMessage = jest.fn();
const mockReadAllMessages = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

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

jest.mock('@/components/messages/MessageToast', () => ({
  __esModule: true,
  default: ({ text }: { text: string | null }) =>
    text ? <div data-testid='toast'>{text}</div> : null,
}));

jest.mock('@/components/messages/MessagePanel', () => ({
  __esModule: true,
  default: ({
    open,
    page,
    onRead,
    onReadAll,
  }: {
    open: boolean;
    page: UserMessagePage;
    onRead: (
      message: UserMessagePage['items'][number],
      navigate?: boolean,
    ) => void;
    onReadAll: () => void;
  }) =>
    open ? (
      <div data-testid='panel'>
        <span data-testid='panel-total'>{page.total}</span>
        {page.items.map((item) => (
          <button
            key={item.id}
            data-testid={`read-${item.id}`}
            onClick={() => onRead(item, true)}
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
    unreadCount,
    trackingUnreadCount: unreadCount,
    revision,
    announcement: null,
    latestTracking: {
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
    window.localStorage.clear();
    mockGetMessageSummary.mockResolvedValue(summaryOf('rev-1', 1));
    mockGetMessagePage.mockResolvedValue(pageOf(1));
    mockReadMessage.mockResolvedValue({});
    mockReadAllMessages.mockResolvedValue({ updatedRecords: {} });
  });

  it('挂载后暴露未读数并弹出提示', async () => {
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId('unread').textContent).toBe('1'),
    );
    expect(screen.getByTestId('tracking-unread').textContent).toBe('1');
    expect(screen.getByTestId('toast')).toBeInTheDocument();
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

  it('已读追更消息后跳转播放页', async () => {
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

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush.mock.calls[0][0]).toContain('/play?');
    expect(mockPush.mock.calls[0][0]).toContain('source=source');
  });

  it('标记已读失败时不跳转', async () => {
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

    expect(mockPush).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
