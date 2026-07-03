/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  saveConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: jest.fn(),
    registerUser: jest.fn(),
  },
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: jest.fn(),
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

function createConfig() {
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
      AutoSwitchSourceOnTimeout: false,
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
      Users: [],
      OpenRegister: true,
      Tags: [],
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

describe('register route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getOwnerUsername as jest.Mock).mockReturnValue('owner');
    (getConfig as jest.Mock).mockResolvedValue(createConfig());
    (saveConfig as jest.Mock).mockResolvedValue(undefined);
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (db.registerUser as jest.Mock).mockResolvedValue(undefined);
  });

  it('registers a user successfully', async () => {
    const { POST } = require('./route');

    const response = await POST(
      createRequest({ username: ' demo-user ', password: 'strong-password' }),
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(db.registerUser).toHaveBeenCalledWith(
      'demo-user',
      'strong-password',
    );
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects weak passwords', async () => {
    const { POST } = require('./route');

    const response = await POST(
      createRequest({ username: 'demo-user', password: 'short' }),
    );

    await expect(response.json()).resolves.toEqual({
      error: '密码长度不能少于 8 位',
    });
    expect(response.status).toBe(400);
    expect(db.registerUser).not.toHaveBeenCalled();
  });

  it('returns 409 when username already exists', async () => {
    (db.checkUserExist as jest.Mock).mockResolvedValue(true);
    const { POST } = require('./route');

    const response = await POST(
      createRequest({ username: 'demo-user', password: 'strong-password' }),
    );

    await expect(response.json()).resolves.toEqual({ error: '用户名已存在' });
    expect(response.status).toBe(409);
    expect(db.registerUser).not.toHaveBeenCalled();
  });

  it('returns 409 when concurrent registration hits duplicate constraint', async () => {
    (db.registerUser as jest.Mock).mockRejectedValueOnce({
      code: 'ER_DUP_ENTRY',
    });
    const { POST } = require('./route');

    const response = await POST(
      createRequest({ username: 'demo-user', password: 'strong-password' }),
    );

    await expect(response.json()).resolves.toEqual({ error: '用户名已存在' });
    expect(response.status).toBe(409);
  });
});
