import { act, renderHook } from '@testing-library/react';

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

    mockedAdminGet.mockResolvedValueOnce({
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
    expect(mockedAdminGet).toHaveBeenCalledWith(
      '/api/admin/config',
      '获取配置失败',
    );
    expect(setConfig).toHaveBeenCalled();
    expect(setRole).toHaveBeenCalledWith('owner');
    expect(setError).toHaveBeenCalledWith(null);
    expect(setLoading).toHaveBeenLastCalledWith(false);
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
