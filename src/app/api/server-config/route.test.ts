/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfigForRead, getPublicConfig } from '@/lib/config';

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

function createPublicConfig() {
  return {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    OpenRegister: false,
    DisableYellowFilter: false,
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    AutoSwitchSourceOnTimeout: false,
    LiveDirectConnect: false,
    DoubanProxyType: 'direct',
    BangumiDataSource: 'direct',
    DoubanImageProxyType: 'direct',
    CustomCategories: [],
    FluidSearch: true,
  };
}

function createConfig() {
  return {
    SiteConfig: {
      DoubanProxyType: 'custom',
      DoubanProxy: 'https://data.example/fetch?url=',
      BangumiDataSource: 'custom',
      BangumiProxy: 'https://bangumi.example/fetch?url=',
      DoubanImageProxyType: 'custom',
      DoubanImageProxy: 'https://image.example/fetch?url=',
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

  it('does not expose custom proxy URLs to authenticated users', async () => {
    const { GET } = require('./route');

    const response = await GET({} as NextRequest);
    const body = await response.json();

    expect(body).toMatchObject({
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      BangumiDataSource: 'direct',
      BangumiProxy: '',
      DoubanImageProxyType: 'direct',
      DoubanImageProxy: '',
    });
  });
});
