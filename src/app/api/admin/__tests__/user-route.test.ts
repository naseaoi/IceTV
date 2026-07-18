/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { ConfigConflictError, getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';

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
    ConfigConflictError,
  };
});

jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: jest.fn(),
    registerUser: jest.fn(),
  },
}));

if (!(globalThis as any).Headers) {
  class MinimalHeaders {
    private store: Record<string, string> = {};

    constructor(init?: Record<string, string>) {
      if (!init) return;
      Object.entries(init).forEach(([key, value]) => {
        this.set(key, value);
      });
    }

    set(key: string, value: string) {
      this.store[key.toLowerCase()] = String(value);
    }

    get(key: string) {
      return this.store[key.toLowerCase()] ?? null;
    }
  }

  (globalThis as any).Headers = MinimalHeaders;
}

if (!(globalThis as any).Request) {
  (globalThis as any).Request = class {
    constructor(
      public url = '',
      public init: Record<string, unknown> = {},
    ) {}
  };
}

if (!(globalThis as any).Response) {
  class MinimalResponse {
    body: string;
    status: number;
    headers: InstanceType<typeof Headers>;

    constructor(body?: string, init?: { status?: number; headers?: any }) {
      this.body = body || '';
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers || {});
    }

    static json(data: unknown, init?: { status?: number; headers?: any }) {
      const headers = new Headers(init?.headers || {});
      headers.set('content-type', 'application/json');
      return new MinimalResponse(JSON.stringify(data), {
        status: init?.status,
        headers,
      });
    }

    async json() {
      return this.body ? JSON.parse(this.body) : null;
    }
  }

  (globalThis as any).Response = MinimalResponse;
}

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
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 300,
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      BangumiDataSource: 'server',
      BangumiProxy: '',
      DoubanImageProxyType: 'direct',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
    },
    UserConfig: {
      Users: users,
      Tags: [],
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
  });

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

  it('adds user metadata only after database registration succeeds', async () => {
    const POST = getHandler();
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (db.registerUser as jest.Mock).mockResolvedValue(undefined);
    const adminConfig = createAdminConfig();
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
    expect(db.registerUser).toHaveBeenCalledWith('new-user', 'new-password');
    expect(saveConfig).toHaveBeenCalledWith({
      ...adminConfig,
      UserConfig: {
        ...adminConfig.UserConfig,
        Users: [
          {
            username: 'new-user',
            role: 'user',
            tags: ['vip'],
          },
        ],
      },
    });
  });

  it('returns 409 when persisting hits a config conflict', async () => {
    const POST = getHandler();
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (db.registerUser as jest.Mock).mockResolvedValue(undefined);
    (saveConfig as jest.Mock).mockRejectedValue(new ConfigConflictError());

    const response = await POST(
      createRequest({
        action: 'add',
        targetUsername: 'new-user',
        targetPassword: 'new-password',
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
