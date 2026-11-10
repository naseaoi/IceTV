import { act, renderHook } from '@testing-library/react';

import { logout, useLogout } from '@/components/user-menu/account';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});
it.each([0, 502, 400])('退出失败 %s 保留页面并提示', async (status) => {
  const href = window.location.href;
  global.fetch = status
    ? jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ error: '退出失败，请重试' }),
      })
    : jest.fn().mockRejectedValue(new TypeError('offline'));
  await logout();
  expect(window.location.href).toBe(href);
  expect(showToast).toHaveBeenCalledTimes(1);
});
it('退出进行中标记忙碌并阻止重复请求，失败后恢复', async () => {
  let resolve!: (value: unknown) => void;
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result } = renderHook(useLogout);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleLogout();
    void result.current.handleLogout();
  });
  expect(result.current.loggingOut).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve({ ok: false, status: 500, json: async () => ({}) });
    await pending;
  });
  expect(result.current.loggingOut).toBe(false);
});
