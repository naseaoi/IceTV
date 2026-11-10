import {
  deleteUserDanmaku,
  sendUserDanmaku,
} from '@/features/play/lib/danmaku/user-client';
import { DisplayableError } from '@/lib/user-facing-error';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it('弹幕发送保留服务端可展示的失败原因', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 429,
    json: async () => ({ error: '发送太频繁，请稍后再试' }),
  });
  await expect(
    sendUserDanmaku({
      key: 'source+1',
      time: 1,
      text: '你好',
      mode: 0,
      color: '#ffffff',
    }),
  ).rejects.toEqual(new DisplayableError('发送太频繁，请稍后再试'));
});
it('删除返回非 JSON 时提供通用中文错误', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError('html');
    },
  });
  await expect(deleteUserDanmaku('1')).rejects.toEqual(
    new DisplayableError('服务暂时不可用，请稍后重试'),
  );
});
