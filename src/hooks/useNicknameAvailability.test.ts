import { act, renderHook } from '@testing-library/react';

import { useNicknameAvailability } from '@/hooks/useNicknameAvailability';

const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});
it('昵称格式错误在本地反馈，避免请求公开检测接口', () => {
  const { result } = renderHook(() => useNicknameAvailability('管理员'));
  expect(result.current.status).toBe('error');
  expect(result.current.message).toContain('保留名');
  expect(global.fetch).not.toHaveBeenCalled();
});
it('输入变化立即禁止旧结果提交并忽略迟到的可用性响应', async () => {
  let resolveOld!: (response: unknown) => void;
  (global.fetch as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ available: false, error: '昵称已被使用' }),
    });
  const { result, rerender } = renderHook(
    ({ nickname }) => useNicknameAvailability(nickname),
    { initialProps: { nickname: '光影旅人' } },
  );
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  rerender({ nickname: '星空旅人' });
  expect(result.current.status).toBe('checking');
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(result.current.status).toBe('error');
  await act(async () => {
    resolveOld({ ok: true, json: async () => ({ available: true }) });
  });
  expect(result.current.status).toBe('error');
  expect(result.current.message).toBe('昵称已被使用');
});
it('未启用时直接空闲，不进入检测态也不请求接口', async () => {
  const { result } = renderHook(() =>
    useNicknameAvailability('光影旅人', false),
  );
  expect(result.current.status).toBe('idle');
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(global.fetch).not.toHaveBeenCalled();
});
