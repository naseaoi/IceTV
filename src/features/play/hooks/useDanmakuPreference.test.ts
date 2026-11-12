import { showToast } from '@/lib/toast';
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDanmakuPreference } from './useDanmakuPreference';

describe('useDanmakuPreference', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('优先采用服务端设置并清理旧客户端值', async () => {
    localStorage.setItem('danmakuEnabled', 'true');

    const { result } = renderHook(() => useDanmakuPreference(false));

    expect(result.current.enabledRef.current).toBe(false);
    await waitFor(() => {
      expect(localStorage.getItem('danmakuEnabled')).toBeNull();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('没有账号设置时只迁移一次旧客户端值', async () => {
    localStorage.setItem('danmakuEnabled', 'true');

    const { result } = renderHook(() => useDanmakuPreference(null));

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
    await waitFor(() => {
      expect(localStorage.getItem('danmakuEnabled')).toBeNull();
    });
  });

  it('切换开关时更新内存状态并同步账号', async () => {
    const { result } = renderHook(() => useDanmakuPreference(false));

    act(() => {
      result.current.onEnabledChange(true);
    });

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
    expect(localStorage.getItem('danmakuEnabled')).toBeNull();
  });
});

it('账号同步失败保留本机开关并提示', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  const { result } = renderHook(() => useDanmakuPreference(false));
  act(() => result.current.onEnabledChange(true));
  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('弹幕开关未能同步到账号', 'error', {
      key: 'danmaku-preference-sync',
    }),
  );
  expect(result.current.enabledRef.current).toBe(true);
});
