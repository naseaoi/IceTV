import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { getClientAuthSession } from '@/lib/auth-session.client';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

const mockGetAuthInfo = getAuthInfoFromBrowserCookie as jest.MockedFunction<
  typeof getAuthInfoFromBrowserCookie
>;

describe('getClientAuthSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('游客不请求会话接口', async () => {
    mockGetAuthInfo.mockReturnValue(null);

    await expect(getClientAuthSession()).resolves.toEqual({ status: 'guest' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('只在服务端确认会话有效后放行业务页面', async () => {
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'user' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        username: 'alice',
        role: 'user',
      }),
    });

    await expect(getClientAuthSession()).resolves.toEqual({
      status: 'authenticated',
      username: 'alice',
      role: 'user',
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
  });

  it('失效会话按游客处理', async () => {
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'user' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: false, username: 'alice' }),
    });

    await expect(getClientAuthSession()).resolves.toEqual({ status: 'guest' });
  });
});
