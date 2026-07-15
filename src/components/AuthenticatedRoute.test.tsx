import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { AUTH_SESSION_LOST_EVENT } from '@/lib/auth.client';
import {
  ClientAuthSession,
  getClientAuthSession,
} from '@/lib/auth-session.client';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/LoadingStatePanel', () => ({
  __esModule: true,
  default: ({
    title,
    message,
    children,
  }: {
    title: string;
    message?: string;
    children?: ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{message}</span>
      {children}
    </div>
  ),
}));

jest.mock('@/lib/auth-session.client', () => ({
  getClientAuthSession: jest.fn(),
}));

const mockGetClientAuthSession = getClientAuthSession as jest.MockedFunction<
  typeof getClientAuthSession
>;

describe('AuthenticatedRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('会话确认前不挂载受保护内容', async () => {
    let resolveSession: (session: ClientAuthSession) => void = () => {};
    mockGetClientAuthSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );

    render(
      <AuthenticatedRoute activePath='/search' message='请先登录后再搜索'>
        <div>搜索业务内容</div>
      </AuthenticatedRoute>,
    );

    expect(screen.getByText('正在验证登录状态')).toBeInTheDocument();
    expect(screen.queryByText('搜索业务内容')).not.toBeInTheDocument();

    await act(async () => resolveSession({ status: 'guest' }));

    expect(screen.getByText('需要登录')).toBeInTheDocument();
    expect(screen.getByText('请先登录后再搜索')).toBeInTheDocument();
    expect(screen.queryByText('搜索业务内容')).not.toBeInTheDocument();
  });

  it('有效会话才挂载受保护内容', async () => {
    mockGetClientAuthSession.mockResolvedValue({
      status: 'authenticated',
      username: 'alice',
    });

    render(
      <AuthenticatedRoute activePath='/live' message='请先登录后再看直播'>
        <div>直播业务内容</div>
      </AuthenticatedRoute>,
    );

    expect(await screen.findByText('直播业务内容')).toBeInTheDocument();
  });

  it('登录状态失效后切换为统一登录提示', async () => {
    mockGetClientAuthSession.mockResolvedValue({
      status: 'authenticated',
      username: 'alice',
    });

    render(
      <AuthenticatedRoute activePath='/search' message='请先登录后再搜索'>
        <div>搜索业务内容</div>
      </AuthenticatedRoute>,
    );

    expect(await screen.findByText('搜索业务内容')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(AUTH_SESSION_LOST_EVENT));
    });

    expect(screen.getByText('需要登录')).toBeInTheDocument();
    expect(screen.getByText('请先登录后再搜索')).toBeInTheDocument();
    expect(screen.queryByText('搜索业务内容')).not.toBeInTheDocument();
  });
});
