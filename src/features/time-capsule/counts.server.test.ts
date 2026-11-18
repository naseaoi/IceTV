/** @jest-environment node */
import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';

import { getCapsuleCountsForCurrentUser } from './counts.server';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/auth-session.server', () => ({
  getServerAuthSession: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { countCapsules: jest.fn() } }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(cookies).mockResolvedValue({
    get: () => ({ value: 'signed' }),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
});
it('登录用户读取同次渲染计数', async () => {
  jest.mocked(getServerAuthSession).mockResolvedValue({
    status: 'authenticated',
    username: 'alice',
  } as Awaited<ReturnType<typeof getServerAuthSession>>);
  jest
    .mocked(db.countCapsules)
    .mockResolvedValue({ pending: 2, delivered: 60, unread: 3 });
  expect(await getCapsuleCountsForCurrentUser()).toEqual({
    pending: 2,
    delivered: 60,
    unread: 3,
  });
  expect(getServerAuthSession).toHaveBeenCalledWith('signed');
  expect(db.countCapsules).toHaveBeenCalledWith('alice');
});
it('游客和失效会话使用空状态且不查询本人数据', async () => {
  jest.mocked(getServerAuthSession).mockResolvedValue({ status: 'guest' });
  expect(await getCapsuleCountsForCurrentUser()).toEqual({
    pending: 0,
    delivered: 0,
    unread: 0,
  });
  expect(db.countCapsules).not.toHaveBeenCalled();
});
