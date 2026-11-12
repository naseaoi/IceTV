/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import {
  bindCatalogFavorite,
  bindDueCatalogFavorites,
} from '@/features/favorites/lib/catalog-binding.server';
import { requireActiveUser } from '@/lib/api-auth';

installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const { POST } = require('./route') as typeof import('./route');
jest.mock('@/features/favorites/lib/catalog-binding.server', () => ({
  bindCatalogFavorite: jest.fn(),
  bindDueCatalogFavorites: jest.fn(),
}));
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (value: object) => 'response' in value,
}));
const user = { username: 'alice', role: 'user', isOwner: false };
function request(body: unknown) {
  return {
    json: async () => body,
    signal: new AbortController().signal,
  } as NextRequest;
}
beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue(user);
});
it('requires authentication before invoking binding', async () => {
  (requireActiveUser as jest.Mock).mockResolvedValue({
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  });
  expect((await POST(request({}))).status).toBe(401);
  expect(bindDueCatalogFavorites).not.toHaveBeenCalled();
});
it.each([null, [], { key: '' }, { key: 1 }, { key: 'invalid' }])(
  'rejects invalid bodies',
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(bindCatalogFavorite).not.toHaveBeenCalled();
  },
);
it('binds a single key using the authenticated user', async () => {
  (bindCatalogFavorite as jest.Mock).mockResolvedValue({
    status: 'bound',
    key: 'real+1',
  });
  const response = await POST(request({ key: 'douban+1', username: 'other' }));
  expect(await response.json()).toEqual({ status: 'bound', key: 'real+1' });
  expect(bindCatalogFavorite).toHaveBeenCalledWith(
    user,
    'douban+1',
    expect.any(AbortSignal),
  );
});
it('returns batch results for an empty body', async () => {
  (bindDueCatalogFavorites as jest.Mock).mockResolvedValue([
    { status: 'skipped', key: 'douban+1' },
  ]);
  expect(await (await POST(request({}))).json()).toEqual({
    results: [{ status: 'skipped', key: 'douban+1' }],
  });
});
