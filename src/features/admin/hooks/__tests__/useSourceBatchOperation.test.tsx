import { act, renderHook } from '@testing-library/react';

import { useSourceBatchOperation } from '@/features/admin/hooks/useSourceBatchOperation';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

function setup() {
  const showAlert = jest.fn();
  const callSourceApi = jest.fn().mockResolvedValue(undefined);
  const onClearSelection = jest.fn();
  const { result } = renderHook(() =>
    useSourceBatchOperation({
      selectedSources: new Set(['first', 'second']),
      callSourceApi,
      onClearSelection,
      showAlert,
      withLoading: async (_key, action) => action(),
    }),
  );
  return { result, showAlert, callSourceApi, onClearSelection };
}

beforeEach(() => jest.clearAllMocks());

it.each([
  ['batch_enable', '启用了 2 个视频源'],
  ['batch_disable', '禁用了 2 个视频源'],
  ['batch_delete', '删除了 2 个视频源'],
  ['batch_set_proxy_mode', '已将 2 个视频源设为「服务端代理」'],
] as const)('%s 确认后执行并使用轻提示反馈', async (action, message) => {
  const { result, showAlert, callSourceApi, onClearSelection } = setup();
  act(() =>
    result.current.requestBatchOperation(action, { proxyMode: 'server' }),
  );
  expect(result.current.confirmModal.isOpen).toBe(true);
  expect(callSourceApi).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();

  await act(async () => {
    await result.current.confirmModal.onConfirm();
  });

  expect(callSourceApi).toHaveBeenCalledWith({
    action,
    keys: ['first', 'second'],
    ...(action === 'batch_set_proxy_mode' ? { proxyMode: 'server' } : {}),
  });
  expect(showToast).toHaveBeenCalledWith(message, 'success');
  expect(showAlert).not.toHaveBeenCalled();
  expect(onClearSelection).toHaveBeenCalledTimes(1);
  expect(result.current.confirmModal.isOpen).toBe(false);
});

it('批量操作失败保留错误弹窗与选中项', async () => {
  const { result, showAlert, callSourceApi, onClearSelection } = setup();
  callSourceApi.mockRejectedValueOnce(new Error('请求失败'));
  act(() => result.current.requestBatchOperation('batch_enable'));
  await act(async () => {
    await result.current.confirmModal.onConfirm();
  });
  expect(showAlert).toHaveBeenCalledWith({
    type: 'error',
    title: '启用失败',
    message: '请求失败',
  });
  expect(showToast).not.toHaveBeenCalled();
  expect(onClearSelection).not.toHaveBeenCalled();
});
