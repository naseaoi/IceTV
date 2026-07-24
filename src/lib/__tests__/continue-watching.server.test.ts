/** @jest-environment node */

import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/auth-session.server', () => ({
  getServerAuthSession: jest.fn(),
}));

const mockCookies = cookies as jest.Mock;
const mockGetServerAuthSession = getServerAuthSession as jest.Mock;

function mockCookieStore(values: Record<string, string>) {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      values[name] === undefined ? undefined : { value: values[name] },
  });
}

describe('getContinueWatchingSkeletonCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({ status: 'guest' });
  });

  it('未登录时不读取播放记录数量', async () => {
    mockCookieStore({ cw_count: '6' });

    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(0);
    expect(mockGetServerAuthSession).not.toHaveBeenCalled();
  });

  it('会话无效时不返回继续观看骨架数量', async () => {
    mockCookieStore({ auth: 'invalid', cw_count: '6' });

    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(0);
    expect(mockGetServerAuthSession).toHaveBeenCalledWith('invalid');
  });

  it('仅为已登录用户返回限制后的骨架数量', async () => {
    mockCookieStore({ auth: 'valid', cw_count: '12' });
    mockGetServerAuthSession.mockResolvedValue({
      status: 'authenticated',
      username: 'alice',
      role: 'user',
    });

    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(8);
  });
});
