/** @jest-environment node */

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, resetConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';

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

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  resetConfig: jest.fn(),
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    saveAdminConfig: jest.fn(),
  },
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
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedResetConfig = resetConfig as jest.MockedFunction<
    typeof resetConfig
  >;
  const mockedGetOwnerUsername = getOwnerUsername as jest.MockedFunction<
    typeof getOwnerUsername
  >;
  const mockedSaveAdminConfig = db.saveAdminConfig as jest.MockedFunction<
    typeof db.saveAdminConfig
  >;

  const baseConfig = {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 'IceTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 300,
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      DoubanImageProxyType: 'direct',
      DoubanImageProxy: '',
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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localdb';
    mockedGetOwnerUsername.mockReturnValue('owner-1');
    mockedGetConfig.mockResolvedValue(baseConfig as never);
  });

  it('returns 401 when request is unauthenticated', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue(null);

    const response = await getAdminConfig({} as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'normal-1',
      expiresAt: Date.now() + 60_000,
    });

    const response = await getAdminConfig({} as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '你是管理员吗你就访问？' });
  });

  it('allows admin user to access admin config', async () => {
    const { getAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'admin-1',
      expiresAt: Date.now() + 60_000,
    });

    const response = await getAdminConfig({} as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.Role).toBe('admin');
    expect(payload.Config).toBeDefined();
  });

  it('returns 403 when non-owner tries to reset config', async () => {
    const { resetAdminConfig } = getHandlers();
    mockedGetAuthInfoFromCookie.mockReturnValue({
      username: 'admin-1',
      expiresAt: Date.now() + 60_000,
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
    });

    const request = {
      json: async () => ({
        SiteName: 'IceTV',
        Announcement: 'hello',
        SearchDownstreamMaxPage: 5,
        SiteInterfaceCacheTime: 300,
        DoubanProxyType: 'direct',
        DoubanProxy: '',
        DoubanImageProxyType: 'direct',
        DoubanImageProxy: '',
        DisableYellowFilter: false,
        FluidSearch: true,
      }),
    } as any;

    const response = await updateSiteConfig(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(mockedSaveAdminConfig).toHaveBeenCalledTimes(1);
  });
});
