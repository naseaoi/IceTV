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

  it('serializes mutations and runs the post-refresh callback', async () => {
    let resolveFirstPost: (() => void) | undefined;
    mockedAdminPost
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPost = () => resolve({} as never);
          }),
      )
      .mockResolvedValueOnce({} as never);
    const refreshConfig = jest.fn().mockResolvedValue(undefined);
    const afterRefresh = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAdminSourceActions({
        endpoint: '/api/admin/category',
        refreshConfig,
        afterRefresh,
        showAlert: jest.fn(),
      }),
    );

    let firstAction: Promise<void>;
    let secondAction: Promise<void>;
    act(() => {
      firstAction = result.current.runAction({ action: 'disable' });
      secondAction = result.current.runAction({ action: 'delete' });
    });

    expect(mockedAdminPost).toHaveBeenCalledTimes(0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedAdminPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstPost?.();
      await Promise.all([firstAction, secondAction]);
    });

    expect(mockedAdminPost.mock.calls.map((call) => call[1])).toEqual([
      { action: 'disable' },
      { action: 'delete' },
    ]);
    expect(refreshConfig).toHaveBeenCalledTimes(2);
    expect(afterRefresh).toHaveBeenCalledTimes(2);
  });
});
