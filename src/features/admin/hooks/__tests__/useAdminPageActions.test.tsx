import { act, renderHook, waitFor } from '@testing-library/react';

import { useAdminPageActions } from '@/features/admin/hooks/useAdminPageActions';
import { adminGet } from '@/features/admin/lib/api';
import { showSuccess } from '@/features/admin/lib/notifications';

jest.mock('@/features/admin/lib/api', () => ({
  adminGet: jest.fn(),
}));

jest.mock('@/features/admin/lib/notifications', () => ({
  showError: jest.fn(),
  showSuccess: jest.fn(),
}));

describe('useAdminPageActions', () => {
  const mockedAdminGet = adminGet as jest.MockedFunction<typeof adminGet>;
  const mockedShowSuccess = showSuccess as jest.MockedFunction<
    typeof showSuccess
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads admin config and updates page state', async () => {
    const setConfig = jest.fn();
    const setRole = jest.fn();
    const setError = jest.fn();
    const setLoading = jest.fn();
    const showAlert = jest.fn();

    mockedAdminGet
      .mockResolvedValueOnce({
        authenticated: true,
        role: 'owner',
      } as never)
      .mockResolvedValueOnce({
        Role: 'owner',
        Config: { SiteConfig: { SiteName: 'Luna' } },
      } as never);

    const { result } = renderHook(() =>
      useAdminPageActions({
        showAlert,
        setConfig,
        setRole,
        setError,
        setLoading,
      }),
    );

    await act(async () => {
      await result.current.fetchConfig(true);
    });

    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(mockedAdminGet).toHaveBeenNthCalledWith(
      1,
      '/api/auth/status',
      '获取登录状态失败',
    );
    expect(mockedAdminGet).toHaveBeenNthCalledWith(
      2,
      '/api/admin/config',
      '获取配置失败',
    );
    expect(setConfig).toHaveBeenCalled();
    expect(setRole).toHaveBeenCalledWith('owner');
    expect(setError).toHaveBeenCalledWith(null);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it('stops before admin config when user is not admin', async () => {
    const setConfig = jest.fn();
    const setRole = jest.fn();
    const setError = jest.fn();
    const setLoading = jest.fn();
    const showAlert = jest.fn();

    mockedAdminGet.mockResolvedValueOnce({
      authenticated: true,
      role: 'user',
    } as never);

    const { result } = renderHook(() =>
      useAdminPageActions({
        showAlert,
        setConfig,
        setRole,
        setError,
        setLoading,
      }),
    );

    await act(async () => {
      await result.current.fetchConfig(true);
    });

    expect(mockedAdminGet).toHaveBeenCalledTimes(1);
    expect(mockedAdminGet).toHaveBeenCalledWith(
      '/api/auth/status',
      '获取登录状态失败',
    );
    expect(setConfig).not.toHaveBeenCalled();
    expect(setRole).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('权限不足');
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it('ignores an older config response that finishes last', async () => {
    const setConfig = jest.fn();
    let resolveFirstConfig: ((value: unknown) => void) | undefined;
    const firstConfig = new Promise((resolve) => {
      resolveFirstConfig = resolve;
    });
    let configRequestCount = 0;
    mockedAdminGet.mockImplementation((endpoint) => {
      if (endpoint === '/api/auth/status') {
        return Promise.resolve({ authenticated: true, role: 'owner' }) as never;
      }
      configRequestCount += 1;
      if (configRequestCount === 1) {
        return firstConfig as never;
      }
      return Promise.resolve({
        Role: 'owner',
        Config: { SiteConfig: { SiteName: '最新配置' } },
      }) as never;
    });

    const { result } = renderHook(() =>
      useAdminPageActions({
        showAlert: jest.fn(),
        setConfig,
        setRole: jest.fn(),
        setError: jest.fn(),
        setLoading: jest.fn(),
      }),
    );

    let firstRequest: Promise<void>;
    act(() => {
      firstRequest = result.current.fetchConfig();
    });
    await waitFor(() => expect(configRequestCount).toBe(1));

    await act(async () => {
      await result.current.fetchConfig();
    });

    await act(async () => {
      resolveFirstConfig?.({
        Role: 'owner',
        Config: { SiteConfig: { SiteName: '旧配置' } },
      });
      await firstRequest;
    });

    expect(setConfig).toHaveBeenCalledTimes(1);
    expect(setConfig).toHaveBeenCalledWith({
      SiteConfig: { SiteName: '最新配置' },
    });
  });

  it('resets admin config through reset endpoint', async () => {
    const showAlert = jest.fn();

    mockedAdminGet.mockResolvedValueOnce({} as never);

    const { result } = renderHook(() =>
      useAdminPageActions({
        showAlert,
        setConfig: jest.fn(),
        setRole: jest.fn(),
        setError: jest.fn(),
        setLoading: jest.fn(),
      }),
    );

    await act(async () => {
      await result.current.resetConfig();
    });

    expect(mockedAdminGet).toHaveBeenCalledWith('/api/admin/reset', '重置失败');
    expect(mockedShowSuccess).toHaveBeenCalledWith(
      '重置成功，请刷新页面！',
      showAlert,
    );
  });
});
