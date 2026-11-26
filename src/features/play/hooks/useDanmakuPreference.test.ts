import { act, renderHook, waitFor } from '@testing-library/react';

import { showToast } from '@/lib/toast';

import { useDanmakuPreference } from './useDanmakuPreference';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

describe('useDanmakuPreference', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([true, false, null])('采用账号设置 %s，缺省关闭', (initial) => {
    const { result } = renderHook(() => useDanmakuPreference(initial));

    expect(result.current.enabledRef.current).toBe(initial ?? false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('切换开关时更新内存状态并同步账号', async () => {
    const { result } = renderHook(() => useDanmakuPreference(false));

    act(() => result.current.onEnabledChange(true));

    expect(result.current.enabledRef.current).toBe(true);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/danmaku/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        }),
      );
    });
  });

  it('连续切换按顺序保存，前一次完成后才提交下一次', async () => {
    let finishFirst!: (response: { ok: boolean }) => void;
    global.fetch = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDanmakuPreference(false));

    act(() => {
      result.current.onEnabledChange(true);
      result.current.onEnabledChange(false);
    });
    expect(result.current.enabledRef.current).toBe(false);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await act(async () => finishFirst({ ok: true }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/danmaku/settings',
      expect.objectContaining({ body: JSON.stringify({ enabled: false }) }),
    );
  });

  it.each(['http', 'network'])(
    '账号同步失败（%s）保留本机开关并提示，队列继续保存',
    async (failure) => {
      global.fetch =
        failure === 'http'
          ? jest
              .fn()
              .mockResolvedValueOnce({ ok: false })
              .mockResolvedValue({ ok: true })
          : jest
              .fn()
              .mockRejectedValueOnce(new Error('network'))
              .mockResolvedValue({ ok: true });
      const { result } = renderHook(() => useDanmakuPreference(false));
      act(() => result.current.onEnabledChange(true));
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith(
          '弹幕开关未能同步到账号',
          'error',
          {
            key: 'danmaku-preference-sync',
          },
        ),
      );
      expect(result.current.enabledRef.current).toBe(true);
      act(() => result.current.onEnabledChange(false));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    },
  );
});
