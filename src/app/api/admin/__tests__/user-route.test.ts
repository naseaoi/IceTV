/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireAdmin } from '@/lib/api-auth';
import { ConfigConflictError, getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';
import type { AdminConfig } from '@/types/admin';

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/config', () => {
  class ConfigConflictError extends Error {
    constructor() {
      super('配置已被其他操作更新，请刷新后重试');
      this.name = 'ConfigConflictError';
    }
  }
  return {
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
    invalidateConfigCache: jest.fn(),
    ConfigConflictError,
  };
});

jest.mock('@/lib/db', () => ({
  db: {
    getUserAccess: jest.fn(),
    updateUserAccess: jest.fn(),
    checkUserExist: jest.fn(),
    registerUser: jest.fn(),
  },
}));

installWebPolyfills();

function createAdminConfig() {
  const users: Array<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    banned?: boolean;
    tags?: string[];
  }> = [];

  return {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 'IceTV',
      SiteIcon: '',
      Announcement: '',
      EnableLiveEntry: false,
      DefaultAggregateSearch: true,
      EnableOptimization: true,
      LiveDirectConnect: false,
      AutoSwitchSource: false,
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 300,
      DoubanProxyType: 'direct',
      DoubanImageProxyType: 'direct',
      DisableYellowFilter: false,
      FluidSearch: true,
    },
    UserConfig: {
      Users: users,
      Tags: [] as NonNullable<AdminConfig['UserConfig']['Tags']>,
      OpenRegister: false,
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };
}

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as NextRequest;
}

function getHandler() {
  const { POST } = require('../user/route');
  return POST as (request: NextRequest) => Promise<Response>;
}

describe('admin user route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue({
      username: 'owner-1',
      isOwner: true,
      isAdmin: true,
      role: 'owner',
    });
    (getConfig as jest.Mock).mockResolvedValue(createAdminConfig());
    (saveConfig as jest.Mock).mockResolvedValue(createAdminConfig());
    (db.getUserAccess as jest.Mock).mockImplementation(
      async (username) =>
        (await getConfig()).UserConfig.Users?.find(
          (user) => user.username === username,
        ) || null,
    );
    (db.updateUserAccess as jest.Mock).mockResolvedValue(1);
  });

  it.each([true, false, undefined])(
    'stores only a true live grant when adding a group (%s)',
    async (allowLive) => {
      const config = createAdminConfig();
      (getConfig as jest.Mock).mockResolvedValue(config);
      const response = await getHandler()(
        createRequest({
          action: 'userGroup',
          groupAction: 'add',
          groupName: 'live',
          enabledApis: [],
          allowLive,
        }),
      );
      expect(response.status).toBe(200);
      expect(config.UserConfig.Tags).toEqual([
        {
          name: 'live',
          enabledApis: [],
          ...(allowLive === true ? { allowLive: true } : {}),
        },
      ]);
      expect(saveConfig).toHaveBeenCalledWith(config);
    },
  );

  it.each([true, false, undefined])(
    'updates or removes the group live grant (%s)',
    async (allowLive) => {
      const config = createAdminConfig();
      config.UserConfig.Tags = [
        { name: 'live', enabledApis: [], allowLive: true },
      ];
      (getConfig as jest.Mock).mockResolvedValue(config);
      const response = await getHandler()(
        createRequest({
          action: 'userGroup',
          groupAction: 'edit',
          groupName: 'live',
          enabledApis: ['source'],
          allowLive,
        }),
      );
      expect(response.status).toBe(200);
      expect(config.UserConfig.Tags).toEqual([
        {
          name: 'live',
          enabledApis: ['source'],
          ...(allowLive === true ? { allowLive: true } : {}),
        },
      ]);
      expect(saveConfig).toHaveBeenCalledWith(config);
    },
  );

  it('rejects add when the user exists only in the database', async () => {
    const POST = getHandler();
    (db.checkUserExist as jest.Mock).mockResolvedValue(true);

    const response = await POST(
      createRequest({
        action: 'add',
        targetUsername: 'drift-user',
        targetPassword: 'new-password',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '用户已存在' });
    expect(db.registerUser).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('adds user with the chosen group in the registration write', async () => {
    const POST = getHandler();
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (db.registerUser as jest.Mock).mockResolvedValue(undefined);
    const adminConfig = createAdminConfig();
    adminConfig.UserConfig.Tags = [{ name: 'vip', enabledApis: [] }];
    (getConfig as jest.Mock).mockResolvedValue(adminConfig);

    const response = await POST(
      createRequest({
        action: 'add',
        targetUsername: 'new-user',
        targetPassword: 'new-password',
        userGroup: 'vip',
      }),
    );

    expect(response.status).toBe(200);
    expect(db.registerUser).toHaveBeenCalledWith(
      'new-user',
      'new-password',
      undefined,
      ['vip'],
    );
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('rejects adding a user to a missing group', async () => {
    const POST = getHandler();
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (getConfig as jest.Mock).mockResolvedValue(createAdminConfig());

    const response = await POST(
      createRequest({
        action: 'add',
        targetUsername: 'new-user',
        targetPassword: 'new-password',
        userGroup: 'ghost',
      }),
    );

    expect(response.status).toBe(400);
    expect(db.registerUser).not.toHaveBeenCalled();
  });

  it('sets and clears the default user group', async () => {
    const POST = getHandler();
    const adminConfig = createAdminConfig();
    adminConfig.UserConfig.Tags = [{ name: 'vip', enabledApis: [] }];
    (getConfig as jest.Mock).mockResolvedValue(adminConfig);

    const missing = await POST(
      createRequest({ action: 'setDefaultUserGroup', userGroup: 'ghost' }),
    );
    expect(missing.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();

    const set = await POST(
      createRequest({ action: 'setDefaultUserGroup', userGroup: 'vip' }),
    );
    expect(set.status).toBe(200);
    expect(
      (adminConfig.UserConfig as AdminConfig['UserConfig']).DefaultUserGroup,
    ).toBe('vip');

    const cleared = await POST(
      createRequest({ action: 'setDefaultUserGroup', userGroup: '' }),
    );
    expect(cleared.status).toBe(200);
    expect(
      (adminConfig.UserConfig as AdminConfig['UserConfig']).DefaultUserGroup,
    ).toBeUndefined();
  });

  it('returns 409 when persisting hits a config conflict', async () => {
    const POST = getHandler();
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (db.registerUser as jest.Mock).mockResolvedValue(undefined);
    (saveConfig as jest.Mock).mockRejectedValue(new ConfigConflictError());

    const response = await POST(
      createRequest({
        action: 'setOpenRegister',
        openRegister: true,
      }),
    );

    expect(response.status).toBe(409);
  });

  it.each(['updateUserApis', 'updateUserGroups'])(
    'rejects admin %s on owner account',
    async (action) => {
      const POST = getHandler();
      (requireAdmin as jest.Mock).mockResolvedValue({
        username: 'admin-1',
        isOwner: false,
        isAdmin: true,
        role: 'admin',
      });
      const adminConfig = createAdminConfig();
      adminConfig.UserConfig.Users.push({
        username: 'owner-1',
        role: 'owner',
        banned: false,
      });
      (getConfig as jest.Mock).mockResolvedValue(adminConfig);

      const response = await POST(
        createRequest({
          action,
          targetUsername: 'owner-1',
          enabledApis: ['source-a'],
          userGroups: ['vip'],
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: '仅站长可操作站长账号',
      });
      expect(saveConfig).not.toHaveBeenCalled();
    },
  );

  it('rejects admin batch group update containing owner account', async () => {
    const POST = getHandler();
    (requireAdmin as jest.Mock).mockResolvedValue({
      username: 'admin-1',
      isOwner: false,
      isAdmin: true,
      role: 'admin',
    });
    const adminConfig = createAdminConfig();
    adminConfig.UserConfig.Users.push(
      {
        username: 'owner-1',
        role: 'owner',
        banned: false,
      },
      {
        username: 'user-1',
        role: 'user',
        banned: false,
      },
    );
    (getConfig as jest.Mock).mockResolvedValue(adminConfig);

    const response = await POST(
      createRequest({
        action: 'batchUpdateUserGroups',
        usernames: ['user-1', 'owner-1'],
        userGroups: ['vip'],
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: '管理员无法操作站长 owner-1',
    });
    expect(adminConfig.UserConfig.Users[1].tags).toBeUndefined();
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
