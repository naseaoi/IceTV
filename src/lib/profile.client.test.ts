import { socialRequest } from '@/lib/profile.client';
import { DisplayableError, getErrorMessage } from '@/lib/user-facing-error';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it.each([
  [422, { error: '昵称已被使用' }, '昵称已被使用'],
  [502, null, '服务暂时不可用，请稍后重试'],
  [400, {}, '请求失败，请稍后重试'],
])('HTTP %s 转换为可展示错误', async (status, body, message) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => {
      if (body === null) throw new SyntaxError('html');
      return body;
    },
  });
  const error = await socialRequest('/api/profile').catch(
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(DisplayableError);
  expect(getErrorMessage(error, 'fallback')).toBe(message);
});
it('网络异常保持原样，底层文本不透传', async () => {
  const error = new TypeError('Failed to fetch secret-host');
  global.fetch = jest.fn().mockRejectedValue(error);
  await expect(socialRequest('/api/profile')).rejects.toBe(error);
  expect(getErrorMessage(error, '失败')).toBe('网络连接失败，请检查网络后重试');
});
it('错误保留状态码与业务 code', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: '片单已更新', code: 'LIST_VERSION_CONFLICT' }),
  });
  await expect(socialRequest('/api/lists/a/order')).rejects.toMatchObject({
    message: '片单已更新',
    status: 409,
    code: 'LIST_VERSION_CONFLICT',
  });
});
