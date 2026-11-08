/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  isGuardFailure: jest.fn((result) => !!result.response),
}));
jest.mock('@/lib/db', () => ({ db: { getAdminUserPage: jest.fn() } }));
jest.mock('@/features/admin/services/userActions', () => ({
  handleAdminUserAction: jest.fn(),
}));
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
function request(url: string): NextRequest {
  return { url, nextUrl: new URL(url) } as NextRequest;
}
const { GET } =
  require('@/app/api/admin/user/route') as typeof import('@/app/api/admin/user/route');

beforeEach(() => {
  jest.clearAllMocks();
  (db.getAdminUserPage as jest.Mock).mockResolvedValue({
    items: [],
    total: 0,
    nextCursor: null,
  });
});
it.each([false, true])(
  'allows admin and owner to query rows (owner=%s)',
  async (isOwner) => {
    (requireAdmin as jest.Mock).mockResolvedValue({
      username: 'operator',
      isOwner,
    });
    const response = await GET(
      request('http://localhost/api/admin/user?q=ALICE&limit=20'),
    );
    expect(response.status).toBe(200);
    expect(db.getAdminUserPage).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'alice',
        limit: 20,
        operatorUsername: 'operator',
      }),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  },
);
it('preserves guard failure and does not query users', async () => {
  (requireAdmin as jest.Mock).mockResolvedValue({
    response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
  });
  expect((await GET(request('http://localhost/api/admin/user'))).status).toBe(
    403,
  );
  expect(isGuardFailure).toHaveBeenCalled();
  expect(db.getAdminUserPage).not.toHaveBeenCalled();
});
it('rejects malformed query before database access', async () => {
  (requireAdmin as jest.Mock).mockResolvedValue({
    username: 'operator',
    isOwner: false,
  });
  expect(
    (await GET(request('http://localhost/api/admin/user?limit=9999'))).status,
  ).toBe(400);
  expect(db.getAdminUserPage).not.toHaveBeenCalled();
});
