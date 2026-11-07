/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getCachedLiveChannels } from '@/features/live/lib/live';
import { requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (result: { response?: Response }) => !!result.response,
}));
jest.mock('@/features/live/lib/live', () => ({
  getCachedLiveChannels: jest.fn(),
}));
jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { getUserAccess: jest.fn() } }));
jest.mock('@/lib/env.server', () => ({ getOwnerUsername: () => 'owner' }));

installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');
const request = {
  url: 'http://localhost/api/live/channels?source=live',
} as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'viewer' });
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups' },
    UserConfig: { Tags: [{ name: 'live', allowLive: true }] },
  });
  (db.getUserAccess as jest.Mock).mockResolvedValue({ role: 'user', tags: [] });
  (getCachedLiveChannels as jest.Mock).mockResolvedValue({ channels: [] });
});

it('returns 403 before reading channels for a user without live permission', async () => {
  const response = await GET(request);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: '没有直播权限' });
  expect(getCachedLiveChannels).not.toHaveBeenCalled();
});

it('retains 404 while live is disabled', async () => {
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { EnableLiveEntry: false },
  });
  const response = await GET(request);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: '直播未开启' });
  expect(db.getUserAccess).not.toHaveBeenCalled();
});

it('returns channels to a member of a granting group', async () => {
  (db.getUserAccess as jest.Mock).mockResolvedValue({
    role: 'user',
    tags: ['live'],
  });
  expect((await GET(request)).status).toBe(200);
  expect(getCachedLiveChannels).toHaveBeenCalledWith('live');
});

it('preserves the authentication guard response', async () => {
  (requireActiveUser as jest.Mock).mockResolvedValue({
    response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
  });
  expect((await GET(request)).status).toBe(401);
  expect(getConfigForRead).not.toHaveBeenCalled();
});
