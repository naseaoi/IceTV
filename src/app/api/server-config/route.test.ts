/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfigForRead, getPublicConfig } from '@/lib/config';
import { db } from '@/lib/db';

jest.mock('@/lib/db', () => ({ db: { getUserAccess: jest.fn() } }));
jest.mock('@/lib/env.server', () => ({ getOwnerUsername: () => 'owner' }));

jest.mock('@/lib/api-auth', () => ({
  getOptionalActiveUser: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(),
  getPublicConfig: jest.fn(),
}));

jest.mock('@/lib/storage-type', () => ({
  getStorageType: jest.fn(() => 'localdb'),
}));

jest.mock('@/lib/version', () => ({
  CURRENT_UPDATE_BRANCH: 'main',
  CURRENT_VERSION: 'test-version',
}));

installWebPolyfills();

function createPublicConfig() {
  return {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    OpenRegister: false,
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    AutoSwitchSource: true,
    DoubanProxyType: 'direct',
    DoubanImageProxyType: 'direct',
    CustomCategories: [],
    FluidSearch: true,
    VodPageTimeoutSeconds: 15,
    VodFragmentTimeoutSeconds: 12,
  };
}

function createConfig() {
  return {
    SiteConfig: {
      EnableLiveEntry: false,
      LiveAccess: 'all',
      DoubanProxyType: 'custom',
      DoubanImageProxyType: 'custom',
    },
  };
}

describe('server config route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getOptionalActiveUser as jest.Mock).mockResolvedValue({
      username: 'user-1',
    });
    (getPublicConfig as jest.Mock).mockResolvedValue(createPublicConfig());
    (getConfigForRead as jest.Mock).mockResolvedValue(createConfig());
  });

  it.each([
    [null, 'all', true, [], true],
    [null, 'groups', true, [], false],
    ['user-1', 'all', true, [], true],
    ['user-1', 'groups', true, ['live'], true],
    ['user-1', 'groups', true, [], false],
    ['owner', 'groups', true, [], true],
    ['owner', 'groups', false, [], false],
  ])(
    'sets live visibility for %s / %s / %s / %j',
    async (username, LiveAccess, EnableLiveEntry, tags, expected) => {
      (getOptionalActiveUser as jest.Mock).mockResolvedValue(
        username ? { username } : null,
      );
      (getConfigForRead as jest.Mock).mockResolvedValue({
        ...createConfig(),
        SiteConfig: {
          ...createConfig().SiteConfig,
          LiveAccess,
          EnableLiveEntry,
        },
        UserConfig: { Tags: [{ name: 'live', allowLive: true }] },
      });
      (db.getUserAccess as jest.Mock).mockResolvedValue({ role: 'user', tags });
      const { GET } = require('./route');
      const response = await GET({} as NextRequest);
      expect(await response.json()).toMatchObject({
        EnableLiveEntry: expected,
      });
      expect(response.headers.get('Vary')).toBe('Cookie');
      expect(response.headers.get('Cache-Control')).toContain(
        username ? 'private' : 'public',
      );
    },
  );

  it('exposes the user danmaku switch', async () => {
    (getPublicConfig as jest.Mock).mockResolvedValue({
      ...createPublicConfig(),
      EnableUserDanmaku: true,
    });
    const { GET } = require('./route');
    expect(await (await GET({} as NextRequest)).json()).toMatchObject({
      EnableUserDanmaku: true,
    });
  });

  it('does not expose custom proxy URLs to authenticated users', async () => {
    const { GET } = require('./route');

    const response = await GET({} as NextRequest);
    const body = await response.json();

    expect(body).toMatchObject({
      DoubanProxyType: 'auto',
      DoubanProxy: '',
      DoubanImageProxyType: 'auto',
      DoubanImageProxy: '',
    });
  });

  it.each([null, { username: 'user-1' }])(
    'omits the server-only filter flag for session %j',
    async (activeUser) => {
      (getOptionalActiveUser as jest.Mock).mockResolvedValue(activeUser);
      (getPublicConfig as jest.Mock).mockResolvedValue({
        ...createPublicConfig(),
        DisableYellowFilter: true,
      });
      const { GET } = require('./route');

      const response = await GET({} as NextRequest);

      expect(await response.json()).not.toHaveProperty('DisableYellowFilter');
    },
  );

  it('exposes playback fault tolerance settings', async () => {
    const { GET } = require('./route');

    const response = await GET({} as NextRequest);
    const body = await response.json();

    expect(body).toMatchObject({
      AutoSwitchSource: true,
      VodPageTimeoutSeconds: 15,
      VodFragmentTimeoutSeconds: 12,
    });
  });
});
