import { act, renderHook, waitFor } from '@testing-library/react';

import { useUsernameAvailability } from '@/features/auth/hooks/useUsernameAvailability';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

describe('useUsernameAvailability', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays idle when disabled', () => {
    const { result } = renderHook(() =>
      useUsernameAvailability({ username: 'demo-user', enabled: false }),
    );

    expect(result.current.status).toBe('idle');
    jest.advanceTimersByTime(1000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stays idle for an empty username', () => {
    const { result } = renderHook(() =>
      useUsernameAvailability({ username: '', enabled: true }),
    );

    expect(result.current.status).toBe('idle');
    jest.advanceTimersByTime(1000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports checking before the debounce elapses', () => {
    mockFetchOnce({ available: true });

    const { result } = renderHook(() =>
      useUsernameAvailability({ username: 'demo-user', enabled: true }),
    );

    expect(result.current.status).toBe('checking');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports an available username', async () => {
    mockFetchOnce({ available: true });

    const { result } = renderHook(() =>
      useUsernameAvailability({ username: 'demo-user', enabled: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(result.current.status).toBe('available'));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/register/check-username?username=demo-user',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('reports a taken username with the server message', async () => {
    mockFetchOnce({ available: false, error: '用户名已被占用' });

    const { result } = renderHook(() =>
      useUsernameAvailability({ username: 'demo-user', enabled: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(result.current.status).toBe('taken'));
    expect(result.current.message).toBe('用户名已被占用');
  });

  it('reports an error on a failed response', async () => {
    mockFetchOnce({ error: '检测过于频繁，请稍后再试' }, false, 429);

    const { result } = renderHook(() =>
      useUsernameAvailability({ username: 'demo-user', enabled: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.message).toBe('检测过于频繁，请稍后再试');
  });

  it('encodes the username in the query string', async () => {
    mockFetchOnce({ available: true });

    renderHook(() =>
      useUsernameAvailability({ username: 'a.b_c-d', enabled: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      '/api/register/check-username?username=a.b_c-d',
    );
  });

  it('does not fire a request for a username replaced within the debounce window', async () => {
    mockFetchOnce({ available: true });

    const { rerender } = renderHook(
      ({ username }) => useUsernameAvailability({ username, enabled: true }),
      { initialProps: { username: 'demo-user' } },
    );

    jest.advanceTimersByTime(200);
    rerender({ username: 'demo-user-2' });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      '/api/register/check-username?username=demo-user-2',
    );
  });

  it('ignores an aborted request', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const { result } = renderHook(() =>
      useUsernameAvailability({ username: 'demo-user', enabled: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current.status).toBe('checking');
  });

  it('returns to idle when it becomes disabled', async () => {
    mockFetchOnce({ available: true });

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useUsernameAvailability({ username: 'demo-user', enabled }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.status).toBe('available'));

    rerender({ enabled: false });

    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();
  });
});
