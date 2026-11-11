/** @jest-environment node */

import { getAuthInfoFromCookie } from '@/lib/auth.server';
import {
  getConfig,
  getConfigForRead,
  getConfigFresh,
  invalidateConfigCache,
  resetConfig,
  saveConfig,
} from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerPassword, getOwnerUsername } from '@/lib/env.server';
import { verifyAuthSignature } from '@/lib/signing-secret.server';
import {
  commitStagedSiteIcon,
  hasStagedSiteIcon,
} from '@/lib/site-icon-storage.server';

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

    async text() {
      return this.body;
    }
  }

  (globalThis as any).Response = MinimalResponse;
}

jest.mock('@/lib/db', () => ({
  db: {
    getConfigSubscription: jest.fn().mockResolvedValue({
      ConfigFile: '',
      ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    }),
    getLiveSourceChannelCounts: jest.fn().mockResolvedValue({}),
    countAnnouncements: jest.fn().mockResolvedValue(0),
    getUserAccess: jest.fn(),
    getAdminUserPage: jest.fn(),
    countInviteCodes: jest.fn().mockResolvedValue(0),
    countActiveInviteCodes: jest.fn().mockResolvedValue(0),
    recordUserLogin: jest.fn(),
    recordUserActivity: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/auth.server', () => ({
  getAuthInfoFromCookie: jest.fn(),
  getSignatureData: jest.fn(() => 'mock-sign-data'),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getConfigForRead: jest.fn(),
  getConfigFresh: jest.fn(),
  invalidateConfigCache: jest.fn(),
  resetConfig: jest.fn(),
  saveConfig: jest.fn(),
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: jest.fn(),
  getOwnerPassword: jest.fn(),
}));

jest.mock('@/lib/signing-secret.server', () => ({
  verifyAuthSignature: jest.fn(),
}));

jest.mock('@/lib/site-icon-storage.server', () => ({
  commitStagedSiteIcon: jest.fn(),
  hasStagedSiteIcon: jest.fn(),
  removeSiteIcon: jest.fn(),
}));

function getHandlers() {
  const { GET: getAdminConfig } = require('@/app/api/admin/config/route');
  const { GET: resetAdminConfig } = require('@/app/api/admin/reset/route');
  const { POST: updateSiteConfig } = require('@/app/api/admin/site/route');

  return {
    getAdminConfig,
    resetAdminConfig,
    updateSiteConfig,
  };
}

describe('admin api auth guard regression', () => {
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedVerifyAuthSignature = verifyAuthSignature as jest.MockedFunction<
    typeof verifyAuthSignature
  >;
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedGetConfigForRead = getConfigForRead as jest.MockedFunction<
    typeof getConfigForRead
  >;
  const mockedGetConfigFresh = getConfigFresh as jest.MockedFunction<
    typeof getConfigFresh
  >;
  const mockedResetConfig = resetConfig as jest.MockedFunction<
    typeof resetConfig
  >;
  const mockedSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>;
  const mockedGetOwnerUsername = getOwnerUsername as jest.MockedFunction<
    typeof getOwnerUsername
  >;
  const mockedGetOwnerPassword = getOwnerPassword as jest.MockedFunction<
    typeof getOwnerPassword
  >;
  const mockedCommitStagedSiteIcon =
    commitStagedSiteIcon as jest.MockedFunction<typeof commitStagedSiteIcon>;
  const mockedHasStagedSiteIcon = hasStagedSiteIcon as jest.MockedFunction<
    typeof hasStagedSiteIcon
  >;

  const baseConfig = {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 'IceTV',
      SiteIcon: '',
      Announcement: '',
      EnableLiveEntry: false,
      DefaultAggregateSearch: true,
      EnableOptimization: true,
      AutoSwitchSource: false,
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 300,
      DoubanProxyType: 'direct',
      DoubanImageProxyType: 'direct',
      DisableYellowFilter: false,
      FluidSearch: true,
    },
    UserConfig: {
      Users: [
        { username: 'admin-1', role: 'admin', banned: false },
        { username: 'normal-1', role: 'user', banned: false },
      ],
      Tags: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  it('每次鉴权读取当前权限并带出同一快照，拒绝封禁与删号', async () => {
    const { requireActiveUserFromAuthInfo, isGuardFailure } =
      await import('@/lib/api-auth');
    const auth = {
      username: 'normal-1',
      sessionType: 'account' as const,
      expiresAt: Date.now() + 60_000,
      signature: 'valid',
    };
    const snapshot = {
      username: 'normal-1',
      role: 'admin' as const,
      tags: ['vip'],
      enabledApis: ['a'],
    };
    (db.getUserAccess as jest.Mock).mockResolvedValueOnce(snapshot);
    const first = await requireActiveUserFromAuthInfo(auth);
    expect(first).toMatchObject({ role: 'admin', userAccess: snapshot });
    if (!isGuardFailure(first)) expect(first.userAccess).toBe(snapshot);
    (db.getUserAccess as jest.Mock).mockResolvedValueOnce({
      ...snapshot,
      role: 'user',
    });
    expect(await requireActiveUserFromAuthInfo(auth)).toMatchObject({
      role: 'user',
    });
    (db.getUserAccess as jest.Mock).mockResolvedValueOnce({
      ...snapshot,
      banned: true,
    });
    const banned = await requireActiveUserFromAuthInfo(auth);
    expect(
      isGuardFailure(banned) && (await banned.response.json()),
    ).toMatchObject({ code: 'USER_BANNED' });
    (db.getUserAccess as jest.Mock).mockResolvedValueOnce(null);
    const deleted = await requireActiveUserFromAuthInfo(auth);
    expect(
      isGuardFailure(deleted) && (await deleted.response.json()),
    ).toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(db.getUserAccess).toHaveBeenCalledTimes(4);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localdb';
    mockedGetOwnerUsername.mockReturnValue('owner-1');
    mockedGetOwnerPassword.mockReturnValue('owner-secret');
    mockedVerifyAuthSignature.mockResolvedValue(true);
    mockedHasStagedSiteIcon.mockReturnValue(true);
    mockedGetConfig.mockResolvedValue(baseConfig as never);
    mockedGetConfigForRead.mockResolvedValue(baseConfig as never);
    mockedGetConfigFresh.mockResolvedValue(baseConfig as never);
    (db.getUserAccess as jest.Mock).mockImplementation(
      async (username) =>
        baseConfig.UserConfig.Users.find(
          (user) => user.username === username,
        ) || null,
    );
    (db.getAdminUserPage as jest.Mock).mockResolvedValue({
      total: baseConfig.UserConfig.Users.length,
      items: [],
      nextCursor: null,
    });
  });

  it('returns 401 when request is unauthenticated', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue(null);

    const response = await getAdminConfig({
      url: 'http://localhost/api/admin/config',
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'normal-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const response = await getAdminConfig({
      url: 'http://localhost/api/admin/config',
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '你是管理员吗你就访问？' });
  });

  it('allows admin user to access admin config', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'admin-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const response = await getAdminConfig({
      url: 'http://localhost/api/admin/config',
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.Role).toBe('admin');
    expect(payload.Config).toBeDefined();
    expect(payload.Config.UserConfig.Users).toEqual([]);
    expect(payload.Config.UserConfig.TotalUsers).toBe(
      baseConfig.UserConfig.Users.length,
    );
    expect(payload.Config.SiteConfig.UpstreamProxyPoolConfigured).toBe(false);
  });

  it('reports a configured upstream proxy pool to admins', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'admin-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });
    const original = process.env.UPSTREAM_PROXY_POOL;
    process.env.UPSTREAM_PROXY_POOL = 'http://127.0.0.1:8081,direct';
    try {
      const response = await getAdminConfig({
        url: 'http://localhost/api/admin/config',
      } as any);
      const payload = await response.json();
      expect(payload.Config.SiteConfig.UpstreamProxyPoolConfigured).toBe(true);
    } finally {
      if (original === undefined) delete process.env.UPSTREAM_PROXY_POOL;
      else process.env.UPSTREAM_PROXY_POOL = original;
    }
  });

  it('returns 403 when non-owner tries to reset config', async () => {
    const { resetAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'admin-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const response = await resetAdminConfig({} as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '仅支持站长重置配置' });
    expect(mockedResetConfig).not.toHaveBeenCalled();
  });

  it('allows owner to update site config', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const request = {
      json: async () => ({
        SiteName: 'IceTV',
        SiteIcon: '',
        Announcement: 'hello',
        FooterText: '',
        EnableLiveEntry: false,
        DefaultAggregateSearch: true,
        EnableOptimization: true,
        AutoSwitchSource: true,
        SearchDownstreamMaxPage: 5,
        SiteInterfaceCacheTime: 300,
        DoubanProxyType: 'direct',
        DoubanImageProxyType: 'direct',
        DisableYellowFilter: false,
        FluidSearch: true,
      }),
    } as any;

    const response = await updateSiteConfig(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(invalidateConfigCache).mock.invocationCallOrder[0],
    ).toBeLessThan(mockedGetConfig.mock.invocationCallOrder[0]);
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SiteConfig: expect.objectContaining({ AutoSwitchSource: true }),
      }),
    );
  });

  it.each(['groups', 'all', undefined, 'invalid', null])(
    'validates and preserves live access %j',
    async (LiveAccess) => {
      const { updateSiteConfig } = getHandlers();
      mockedGetAuthInfoFromCookie.mockReturnValue({
        username: 'owner-1',
        expiresAt: Date.now() + 60_000,
        signature: 'mock-signature',
        sessionType: 'account',
      });
      const stored = {
        ...baseConfig,
        SiteConfig: { ...baseConfig.SiteConfig, LiveAccess: 'groups' },
      };
      mockedGetConfig.mockResolvedValue(stored as never);
      const response = await updateSiteConfig({
        json: async () => ({
          ...baseConfig.SiteConfig,
          FooterText: '',
          LiveAccess,
        }),
      } as any);
      const valid =
        LiveAccess === undefined ||
        LiveAccess === 'all' ||
        LiveAccess === 'groups';
      expect(response.status).toBe(valid ? 200 : 400);
      if (valid) {
        expect(mockedSaveConfig).toHaveBeenCalledWith(stored);
        expect(stored.SiteConfig.LiveAccess).toBe(LiveAccess ?? 'groups');
      } else {
        expect(await response.json()).toEqual({ error: '直播权限范围无效' });
        expect(mockedSaveConfig).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps the stored auto source switch default when older clients omit it', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });
    mockedGetConfig.mockResolvedValue({
      ...baseConfig,
      SiteConfig: { ...baseConfig.SiteConfig, AutoSwitchSource: true },
    } as never);
    const { AutoSwitchSource: _omitted, ...olderClientBody } =
      baseConfig.SiteConfig;

    const response = await updateSiteConfig({
      json: async () => ({ ...olderClientBody, FooterText: '' }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SiteConfig: expect.objectContaining({ AutoSwitchSource: true }),
      }),
    );
  });

  it('rejects a non-boolean auto source switch default', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const response = await updateSiteConfig({
      json: async () => ({
        ...baseConfig.SiteConfig,
        FooterText: '',
        AutoSwitchSource: 'yes',
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('saves the segment upstream pool switch and ignores the response-only pool flag', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const response = await updateSiteConfig({
      json: async () => ({
        ...baseConfig.SiteConfig,
        FooterText: '',
        UpstreamProxyPoolSegments: true,
        UpstreamProxyPoolConfigured: true,
      }),
    } as any);

    expect(response.status).toBe(200);
    const saved = mockedSaveConfig.mock.calls[0][0].SiteConfig;
    expect(saved.UpstreamProxyPoolSegments).toBe(true);
    expect(saved).not.toHaveProperty('UpstreamProxyPoolConfigured');
  });

  it('rejects a non-boolean segment upstream pool switch', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });

    const response = await updateSiteConfig({
      json: async () => ({
        ...baseConfig.SiteConfig,
        FooterText: '',
        UpstreamProxyPoolSegments: 'on',
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('commits a staged icon only after saving site config', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });
    const order: string[] = [];
    mockedSaveConfig.mockImplementation(async () => {
      order.push('save');
      return baseConfig as never;
    });
    mockedCommitStagedSiteIcon.mockImplementation(() => {
      order.push('commit');
    });

    const response = await updateSiteConfig({
      json: async () => ({
        ...baseConfig.SiteConfig,
        FooterText: '',
        SiteIcon: '/api/admin/site-icon',
        SiteIconStagingToken: '11111111-1111-1111-1111-111111111111',
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(order).toEqual(['save', 'commit']);
  });

  it('rejects a missing staged icon without saving config', async () => {
    const { updateSiteConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'owner-1',
      expiresAt: Date.now() + 60_000,
      signature: 'mock-signature',
      sessionType: 'account',
    });
    mockedHasStagedSiteIcon.mockReturnValue(false);

    const response = await updateSiteConfig({
      json: async () => ({
        ...baseConfig.SiteConfig,
        FooterText: '',
        SiteIcon: '/api/admin/site-icon',
        SiteIconStagingToken: '11111111-1111-1111-1111-111111111111',
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
    expect(mockedCommitStagedSiteIcon).not.toHaveBeenCalled();
  });
});
