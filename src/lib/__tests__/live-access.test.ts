/** @jest-environment node */

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { canUserWatchLive } from '@/lib/live-access.server';
import type { AdminConfig } from '@/types/admin';

jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { getUserAccess: jest.fn() } }));
jest.mock('@/lib/env.server', () => ({ getOwnerUsername: () => ' Owner ' }));

function config(site: object = {}): AdminConfig {
  return {
    SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups', ...site },
    UserConfig: {
      Tags: [
        { name: 'live', enabledApis: [], allowLive: true },
        { name: 'vod', enabledApis: ['source'] },
        { name: 'off', enabledApis: [], allowLive: false },
      ],
    },
  } as AdminConfig;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getConfigForRead as jest.Mock).mockResolvedValue(config());
  (db.getUserAccess as jest.Mock).mockResolvedValue(null);
});

it('denies disabled live even for the owner without querying user access', async () => {
  expect(
    await canUserWatchLive('owner', config({ EnableLiveEntry: false })),
  ).toBe(false);
  expect(db.getUserAccess).not.toHaveBeenCalled();
});

it.each(['all', undefined, 'invalid'])(
  'allows unrestricted live (%s) without querying user access',
  async (LiveAccess) => {
    expect(await canUserWatchLive(undefined, config({ LiveAccess }))).toBe(
      true,
    );
    expect(db.getUserAccess).not.toHaveBeenCalled();
  },
);

it('normalizes the environment owner and allows it without an access row', async () => {
  expect(await canUserWatchLive(' OWNER ')).toBe(true);
  expect(getConfigForRead).toHaveBeenCalledTimes(1);
  expect(db.getUserAccess).not.toHaveBeenCalled();
});

it.each(['admin', 'owner'])('allows stored staff role %s', async (role) => {
  (db.getUserAccess as jest.Mock).mockResolvedValue({ role });
  expect(await canUserWatchLive(' Staff ', config())).toBe(true);
  expect(db.getUserAccess).toHaveBeenCalledWith('staff');
  expect(getConfigForRead).not.toHaveBeenCalled();
});

it.each([
  [['vod', 'live'], true],
  [['vod'], false],
  [['off'], false],
  [['missing'], false],
  [[], false],
  [undefined, false],
])('checks membership in any granting group: %j', async (tags, expected) => {
  (db.getUserAccess as jest.Mock).mockResolvedValue({ role: 'user', tags });
  expect(await canUserWatchLive('user', config())).toBe(expected);
});

it('denies a user without an access record', async () => {
  expect(await canUserWatchLive('missing', config())).toBe(false);
});

it.each([undefined, null, '', ' '])(
  'denies a missing username: %j',
  async (username) => {
    expect(await canUserWatchLive(username, config())).toBe(false);
    expect(db.getUserAccess).not.toHaveBeenCalled();
  },
);
