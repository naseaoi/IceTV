import { adminGet, adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';
import { showToast } from '@/lib/toast';
import { DisplayableError } from '@/lib/user-facing-error';

jest.mock('@/lib/profile.client', () => ({
  PROFILE_REQUIRED_EVENT: 'profile-required',
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('API 将可展示错误封装，非 JSON 502 使用服务不可用提示', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 400,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: '用户名已存在' }),
  } as unknown as Response);
  await expect(adminPost('/api/admin/user')).rejects.toBeInstanceOf(
    DisplayableError,
  );
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 502,
    headers: { get: () => 'text/html' },
  } as unknown as Response);
  await expect(adminGet('/api/admin/config')).rejects.toThrow(
    '服务暂时不可用，请稍后重试',
  );
  expect(showToast).not.toHaveBeenCalled();
});

it('反馈只展示可信文案，网络错误归类，取消静默', () => {
  showError(new Error('secret stack'), '保存失败');
  expect(showToast).toHaveBeenLastCalledWith('保存失败', 'error');
  showError(new DisplayableError('权限不足'));
  expect(showToast).toHaveBeenLastCalledWith('权限不足', 'error');
  showError(new TypeError('Failed to fetch'));
  expect(showToast).toHaveBeenLastCalledWith(
    '网络连接失败，请检查网络后重试',
    'error',
  );
  showError(new DOMException('aborted', 'AbortError'));
  expect(showToast).toHaveBeenCalledTimes(3);
});
