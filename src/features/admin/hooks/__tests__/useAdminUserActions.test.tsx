import { act, renderHook } from '@testing-library/react';

import { useAdminUserActions } from '@/features/admin/hooks/useAdminUserActions';
import { adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';

jest.mock('@/features/admin/lib/api', () => ({
  adminPost: jest.fn(),
}));

jest.mock('@/features/admin/lib/notifications', () => ({
  showError: jest.fn(),
}));

describe('useAdminUserActions', () => {
  const mockedAdminPost = adminPost as jest.MockedFunction<typeof adminPost>;
  const mockedShowError = showError as jest.MockedFunction<typeof showError>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes user and refreshes config', async () => {
    const refreshConfig = jest.fn().mockResolvedValue(undefined);
    mockedAdminPost.mockResolvedValueOnce({} as never);

    const { result } = renderHook(() =>
      useAdminUserActions({
        refreshConfig,
        showAlert: jest.fn(),
      }),
    );

    await act(async () => {
      await result.current.userAction('deleteUser', 'demo-user');
    });

    expect(mockedAdminPost).toHaveBeenCalledWith(
      '/api/admin/user',
      { targetUsername: 'demo-user', action: 'deleteUser' },
      '操作失败',
    );
    expect(refreshConfig).toHaveBeenCalled();
  });

  it('sends empty groups when batch target is unrestricted', async () => {
    mockedAdminPost.mockResolvedValueOnce({} as never);
    const refreshConfig = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAdminUserActions({
        refreshConfig,
        showAlert: jest.fn(),
      }),
    );

    await act(async () => {
      await result.current.batchUpdateUserGroups(['u1', 'u2'], '');
    });

    expect(mockedAdminPost).toHaveBeenCalledWith(
      '/api/admin/user',
      {
        action: 'batchUpdateUserGroups',
        usernames: ['u1', 'u2'],
        userGroups: [],
      },
      '操作失败',
    );
  });

  it('reports error when request fails', async () => {
    const showAlert = jest.fn();
    const refreshConfig = jest.fn().mockResolvedValue(undefined);
    mockedAdminPost.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() =>
      useAdminUserActions({
        refreshConfig,
        showAlert,
      }),
    );

    let error: Error | null = null;
    try {
      await act(async () => {
        await result.current.userAction('deleteUser', 'demo-user');
      });
    } catch (err) {
      error = err as Error;
    }

    expect(error?.message).toBe('boom');

    expect(mockedShowError).toHaveBeenCalledWith('boom', showAlert);
  });
});
