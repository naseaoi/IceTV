/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireActiveUser: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    isPasswordSet: jest.fn(),
    changePassword: jest.fn(),
    verifyUser: jest.fn(),
    checkUserExist: jest.fn(),
    getUserAccess: jest.fn(),
    recordUserActivity: jest.fn(),
  },
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: () => 'owner',
  getOwnerPassword: () => 'owner-password',
}));
jest.mock('@/lib/login-session.server', () => ({
  generateAuthCookie: jest.fn().mockResolvedValue({ username: 'linux_user' }),
  recordLoginActivity: jest.fn(),
  setAuthCookies: jest.fn(),
}));
jest.mock('@/lib/list-count-seed.server', () => ({
  seedListCountCookies: jest.fn(),
}));

const { GET, POST } = require('./route') as typeof import('./route');
const { POST: login } =
  require('@/app/api/login/route') as typeof import('@/app/api/login/route');

function createRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe('change-password password policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: 'alice',
      isOwner: false,
      role: 'user',
    });
    (db.changePassword as jest.Mock).mockResolvedValue(true);
    (db.isPasswordSet as jest.Mock).mockResolvedValue(true);
  });

  it('rejects new passwords shorter than 8 characters', async () => {
    const response = await POST(
      createRequest({ oldPassword: 'old-pass-1', newPassword: 'short7!' }),
    );

    await expect(response.json()).resolves.toEqual({
      error: '密码长度不能少于 8 位',
    });
    expect(response.status).toBe(400);
    expect(db.changePassword).not.toHaveBeenCalled();
  });

  it('accepts new passwords meeting the minimum length', async () => {
    const response = await POST(
      createRequest({ oldPassword: 'old-pass-1', newPassword: 'longenough8' }),
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(db.changePassword).toHaveBeenCalledWith(
      'alice',
      'longenough8',
      false,
      'old-pass-1',
    );
  });

  it('首次设置不要求旧密码，状态由存储复核', async () => {
    (db.isPasswordSet as jest.Mock).mockResolvedValue(false);
    const status = await GET(createRequest({}));
    expect(await status.json()).toEqual({ hasPassword: false });
    expect(status.headers.get('cache-control')).toBe('no-store');
    const response = await POST(
      createRequest({ newPassword: 'first-password' }),
    );
    expect(response.status).toBe(200);
    expect(db.changePassword).toHaveBeenCalledWith(
      'alice',
      'first-password',
      false,
      null,
    );
  });

  it('已有密码要求旧密码', async () => {
    expect(await (await GET(createRequest({}))).json()).toEqual({
      hasPassword: true,
    });
    (db.changePassword as jest.Mock).mockResolvedValue(false);
    expect(
      (await POST(createRequest({ newPassword: 'next-password' }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          createRequest({
            newPassword: 'next-password',
            oldPassword: 'wrong-password',
          }),
        )
      ).status,
    ).toBe(401);
  });

  it('真实 SQLite：LinuxDo 建号、首次设密、用户名登录和再次改密贯通', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.registerUser(
      'linux_user',
      'random-secret',
      undefined,
      undefined,
      {
        provider: 'linuxdo',
        providerUserId: '123',
        providerUsername: 'Linux_User',
        username: 'linux_user',
        autoCreated: true,
        createdAt: Date.now(),
      },
    );
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: 'linux_user',
      isOwner: false,
    });
    (db.changePassword as jest.Mock).mockImplementation(
      storage.changePassword.bind(storage),
    );
    (db.isPasswordSet as jest.Mock).mockImplementation(
      storage.isPasswordSet.bind(storage),
    );
    (db.checkUserExist as jest.Mock).mockImplementation(
      storage.checkUserExist.bind(storage),
    );
    (db.verifyUser as jest.Mock).mockImplementation(
      storage.verifyUser.bind(storage),
    );
    (db.getUserAccess as jest.Mock).mockImplementation(
      storage.getUserAccess.bind(storage),
    );
    expect(await (await GET(createRequest({}))).json()).toEqual({
      hasPassword: false,
    });
    expect(
      (await POST(createRequest({ newPassword: 'first-password' }))).status,
    ).toBe(200);
    expect(await (await GET(createRequest({}))).json()).toEqual({
      hasPassword: true,
    });
    const request = {
      ...createRequest({
        username: ' Linux_User ',
        password: 'first-password',
      }),
      headers: new Headers(),
    } as NextRequest;
    const response = await login(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.verifyUser).toHaveBeenCalledWith('linux_user', 'first-password');
    expect(
      (await POST(createRequest({ newPassword: 'second-password' }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          createRequest({
            newPassword: 'second-password',
            oldPassword: 'first-password',
          }),
        )
      ).status,
    ).toBe(200);
  });

  it('未登录和站长不能写入密码', async () => {
    (requireActiveUser as jest.Mock).mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect((await GET(createRequest({}))).status).toBe(401);
    expect((await POST(createRequest({}))).status).toBe(401);
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: 'owner',
      isOwner: true,
    });
    expect(
      (await POST(createRequest({ newPassword: 'next-password' }))).status,
    ).toBe(403);
    expect(await (await GET(createRequest({}))).json()).toEqual({
      hasPassword: true,
    });
    expect(db.isPasswordSet).not.toHaveBeenCalled();
    expect(db.changePassword).not.toHaveBeenCalled();
  });
});
