/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireActiveUser: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    verifyUser: jest.fn(),
    changePassword: jest.fn(),
  },
}));

const { POST } = require('./route') as typeof import('./route');

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
    (db.verifyUser as jest.Mock).mockResolvedValue(true);
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
    expect(db.changePassword).toHaveBeenCalledWith('alice', 'longenough8');
  });
});
