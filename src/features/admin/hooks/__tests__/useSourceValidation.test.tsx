import { act, renderHook } from '@testing-library/react';

import { useSourceValidation } from '@/features/admin/hooks/useSourceValidation';

class FakeEventSource {
  static latest: FakeEventSource;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn();
  constructor() {
    FakeEventSource.latest = this;
  }
}
const original = global.EventSource;
beforeEach(() => {
  jest.useFakeTimers();
  global.EventSource = FakeEventSource as unknown as typeof EventSource;
});
afterEach(() => {
  global.EventSource = original;
  jest.useRealTimers();
});

it.each(['parse', 'connection', 'timeout'])(
  '%s 将未完成行收尾且保留已完成结果',
  async (failure) => {
    const { result } = renderHook(() =>
      useSourceValidation({
        sources: [
          { key: 'a', name: '甲', api: 'https://a.test', from: 'custom' },
          { key: 'b', name: '乙', api: 'https://b.test', from: 'custom' },
        ],
      }),
    );
    await act(async () => {
      await result.current.startValidation('测试');
    });
    act(() =>
      FakeEventSource.latest.onmessage?.({
        data: JSON.stringify({
          type: 'source_result',
          source: 'a',
          status: 'valid',
        }),
      }),
    );
    act(() => {
      if (failure === 'parse')
        FakeEventSource.latest.onmessage?.({ data: '{' });
      if (failure === 'connection') FakeEventSource.latest.onerror?.();
      if (failure === 'timeout') jest.advanceTimersByTime(60000);
    });
    expect(result.current.isValidating).toBe(false);
    expect(result.current.getValidationStatus('a')?.text).toBe('有效');
    expect(result.current.getValidationStatus('b')?.text).toBe('无效');
    expect(result.current.error).toBeTruthy();
    expect(FakeEventSource.latest.close).toHaveBeenCalledTimes(1);
  },
);

it('卸载关闭连接并清理计时器', async () => {
  const { result, unmount } = renderHook(() =>
    useSourceValidation({ sources: [] }),
  );
  await act(async () => {
    await result.current.startValidation('测试');
  });
  const clear = jest.spyOn(global, 'clearTimeout');
  unmount();
  expect(FakeEventSource.latest.close).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalled();
  clear.mockRestore();
});
