/** @jest-environment node */

import { isGuardFailure, requireActiveUserFromAuthInfo } from '@/lib/api-auth';
import { parseAuthCookieValue } from '@/lib/auth.server';
import { getServerAuthSession } from '@/lib/auth-session.server';

jest.mock('server-only', () => ({}));

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn(),
  requireActiveUserFromAuthInfo: jest.fn(),
}));

jest.mock('@/lib/auth.server', () => ({
  parseAuthCookieValue: jest.fn(),
}));

const mockIsGuardFailure = isGuardFailure as jest.MockedFunction<
  typeof isGuardFailure
>;
const mockRequireActiveUserFromAuthInfo =
  requireActiveUserFromAuthInfo as jest.MockedFunction<
    typeof requireActiveUserFromAuthInfo
  >;
const mockParseAuthCookieValue = parseAuthCookieValue as jest.MockedFunction<
  typeof parseAuthCookieValue
>;

describe('getServerAuthSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('无会话 Cookie 时直接返回游客', async () => {
    await expect(getServerAuthSession()).resolves.toEqual({ status: 'guest' });
    expect(mockRequireActiveUserFromAuthInfo).not.toHaveBeenCalled();
  });

  it('服务端确认有效后返回已登录会话', async () => {
    const authInfo = {
      username: 'alice',
      signature: 'signature',
      expiresAt: Date.now() + 60_000,
      sessionType: 'account' as const,
    };
    mockParseAuthCookieValue.mockReturnValue(authInfo);
    mockRequireActiveUserFromAuthInfo.mockResolvedValue({
      username: 'alice',
      isOwner: false,
      role: 'user',
    });
    mockIsGuardFailure.mockReturnValue(false);

    await expect(getServerAuthSession('cookie')).resolves.toEqual({
      status: 'authenticated',
      username: 'alice',
      role: 'user',
    });
    expect(mockRequireActiveUserFromAuthInfo).toHaveBeenCalledWith(authInfo);
  });

  it('服务端拒绝会话时返回游客', async () => {
    mockParseAuthCookieValue.mockReturnValue({ username: 'alice' });
    mockRequireActiveUserFromAuthInfo.mockResolvedValue({
      response: {} as never,
    });
    mockIsGuardFailure.mockReturnValue(true);

    await expect(getServerAuthSession('cookie')).resolves.toEqual({
      status: 'guest',
    });
  });
});
