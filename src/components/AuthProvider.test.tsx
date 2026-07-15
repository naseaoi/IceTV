import { act, fireEvent, render, screen } from '@testing-library/react';

import { AuthProvider, useAuthSession } from '@/components/AuthProvider';
import { AUTH_SESSION_LOST_EVENT } from '@/lib/auth.client';
import { getClientAuthSession } from '@/lib/auth-session.client';

jest.mock('@/lib/auth-session.client', () => ({
  getClientAuthSession: jest.fn(),
}));

const mockGetClientAuthSession = getClientAuthSession as jest.MockedFunction<
  typeof getClientAuthSession
>;

function SessionConsumer() {
  const { session, isRefreshing, refreshSession } = useAuthSession();

  return (
    <div>
      <span>{session.status}</span>
      <span>{isRefreshing ? 'refreshing' : 'idle'}</span>
      <button type='button' onClick={() => void refreshSession()}>
        refresh
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('直接使用服务端注入的初始会话且不发起客户端检查', () => {
    render(
      <AuthProvider
        initialSession={{
          status: 'authenticated',
          username: 'alice',
          role: 'user',
        }}
      >
        <SessionConsumer />
      </AuthProvider>,
    );

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(mockGetClientAuthSession).not.toHaveBeenCalled();
  });

  it('运行中会话失效时统一切换为游客', () => {
    render(
      <AuthProvider
        initialSession={{
          status: 'authenticated',
          username: 'alice',
          role: 'user',
        }}
      >
        <SessionConsumer />
      </AuthProvider>,
    );

    act(() => {
      window.dispatchEvent(new Event(AUTH_SESSION_LOST_EVENT));
    });

    expect(screen.getByText('guest')).toBeInTheDocument();
  });

  it('只在显式刷新时调用客户端会话接口', async () => {
    mockGetClientAuthSession.mockResolvedValue({
      status: 'authenticated',
      username: 'alice',
      role: 'user',
    });

    render(
      <AuthProvider initialSession={{ status: 'error' }}>
        <SessionConsumer />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    expect(await screen.findByText('authenticated')).toBeInTheDocument();
    expect(mockGetClientAuthSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('idle')).toBeInTheDocument();
  });
});
