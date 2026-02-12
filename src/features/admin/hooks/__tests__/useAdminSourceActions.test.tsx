import { act, renderHook } from '@testing-library/react';

import { useAdminSourceActions } from '@/features/admin/hooks/useAdminSourceActions';
import { adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';

jest.mock('@/features/admin/lib/api', () => ({
  adminPost: jest.fn(),
}));

jest.mock('@/features/admin/lib/notifications', () => ({
  showError: jest.fn(),
}));

describe('useAdminSourceActions', () => {
  const mockedAdminPost = adminPost as jest.MockedFunction<typeof adminPost>;
  const mockedShowError = showError as jest.MockedFunction<typeof showError>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves source and refreshes config', async () => {
    const refreshConfig = jest.fn().mockResolvedValue(undefined);
    mockedAdminPost.mockResolvedValueOnce({} as never);

    const { result } = renderHook(() =>
      useAdminSourceActions({
        endpoint: '/api/admin/source',
        refreshConfig,
        showAlert: jest.fn(),
      }),
    );

    await act(async () => {
      await result.current.runAction({ action: 'add', key: 'k1' });
    });

    expect(mockedAdminPost).toHaveBeenCalledWith(
      '/api/admin/source',
      { action: 'add', key: 'k1' },
      '操作失败',
    );
    expect(refreshConfig).toHaveBeenCalled();
  });

  it('reports error when source action fails', async () => {
    const showAlert = jest.fn();
    const refreshConfig = jest.fn().mockResolvedValue(undefined);
    mockedAdminPost.mockRejectedValueOnce(new Error('save failed'));

    const { result } = renderHook(() =>
      useAdminSourceActions({
        endpoint: '/api/admin/source',
        refreshConfig,
        showAlert,
      }),
    );

    let error: Error | null = null;
    try {
      await act(async () => {
        await result.current.runAction({ action: 'add', key: 'k1' });
      });
    } catch (err) {
      error = err as Error;
    }

    expect(error?.message).toBe('save failed');

    expect(mockedShowError).toHaveBeenCalledWith('save failed', showAlert);
  });
});
