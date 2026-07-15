import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { useAuthSession } from '@/components/AuthProvider';

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

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: jest.fn(),
}));

const mockUseAuthSession = useAuthSession as jest.MockedFunction<
  typeof useAuthSession
>;
const mockRefreshSession = jest.fn().mockResolvedValue(undefined);

describe('AuthenticatedRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      session: { status: 'guest' },
      isRefreshing: false,
      refreshSession: mockRefreshSession,
    });
  });

  it('游客直接显示登录提示且不挂载受保护内容', () => {
    render(
      <AuthenticatedRoute activePath='/search' message='请先登录后再搜索'>
        <div>搜索业务内容</div>
      </AuthenticatedRoute>,
    );

    expect(screen.getByText('需要登录')).toBeInTheDocument();
    expect(screen.getByText('请先登录后再搜索')).toBeInTheDocument();
    expect(screen.queryByText('搜索业务内容')).not.toBeInTheDocument();
  });

  it('服务端确认的有效会话首次渲染就挂载受保护内容', () => {
    mockUseAuthSession.mockReturnValue({
      session: { status: 'authenticated', username: 'alice' },
      isRefreshing: false,
      refreshSession: mockRefreshSession,
    });

    render(
      <AuthenticatedRoute activePath='/live' message='请先登录后再看直播'>
        <div>直播业务内容</div>
      </AuthenticatedRoute>,
    );

    expect(screen.getByText('直播业务内容')).toBeInTheDocument();
    expect(screen.queryByText('正在验证登录状态')).not.toBeInTheDocument();
  });

  it('只在用户主动重试时显示重新验证状态', () => {
    mockUseAuthSession.mockReturnValue({
      session: { status: 'error' },
      isRefreshing: true,
      refreshSession: mockRefreshSession,
    });

    render(
      <AuthenticatedRoute activePath='/search' message='请先登录后再搜索'>
        <div>搜索业务内容</div>
      </AuthenticatedRoute>,
    );

    expect(screen.getByText('正在重新验证登录状态')).toBeInTheDocument();
    expect(screen.queryByText('搜索业务内容')).not.toBeInTheDocument();
  });

  it('会话检查失败时允许用户主动重试', () => {
    mockUseAuthSession.mockReturnValue({
      session: { status: 'error' },
      isRefreshing: false,
      refreshSession: mockRefreshSession,
    });

    render(
      <AuthenticatedRoute activePath='/search' message='请先登录后再搜索'>
        <div>搜索业务内容</div>
      </AuthenticatedRoute>,
    );

    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });
});
