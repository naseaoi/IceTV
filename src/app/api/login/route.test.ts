/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockCheckUserExist = jest.fn();
const mockVerifyUser = jest.fn();
const mockGetConfig = jest.fn();
const mockVerifyPassword = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: (...args: unknown[]) => mockCheckUserExist(...args),
    verifyUser: (...args: unknown[]) => mockVerifyUser(...args),
  },
}));

jest.mock('@/lib/config', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerPassword: () => 'owner-pass',
  getOwnerUsername: () => 'owner',
}));

jest.mock('@/lib/password', () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

jest.mock('@/lib/signing-secret.server', () => ({
  getAuthSigningSecret: () => 'auth-secret',
}));

const { POST } = require('./route') as typeof import('./route');

function createLoginRequest(username: string, password: string): NextRequest {
  return {
    nextUrl: new URL('http://localhost/api/login'),
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({ username, password }),
  } as NextRequest;
}

describe('login route enumeration hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'banned-user', role: 'user', banned: true }],
      },
    });
    mockVerifyPassword.mockResolvedValue({ match: false, needsRehash: false });
  });

  it('does not reveal banned state before password verification succeeds', async () => {
    mockCheckUserExist.mockResolvedValue(true);
    mockVerifyUser.mockResolvedValue(false);

    const response = await POST(
      createLoginRequest('banned-user', 'wrong-password'),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: '用户名或密码错误' });
    expect(mockGetConfig).not.toHaveBeenCalled();
  });

  it('uses a dummy password verification for missing users', async () => {
    mockCheckUserExist.mockResolvedValue(false);

    const response = await POST(createLoginRequest('missing-user', 'password'));

    expect(response.status).toBe(401);
    expect(mockVerifyUser).not.toHaveBeenCalled();
    expect(mockVerifyPassword).toHaveBeenCalledWith(
      'password',
      expect.stringMatching(/^\$2b\$10\$/),
    );
  });
});
