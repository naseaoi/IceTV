/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { getConfig, saveConfig } from '@/lib/config';
import { buildConfigFileFromAdminConfig } from '@/lib/config-file-json';

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  saveConfig: jest.fn(),
}));

jest.mock('@/lib/config-file-json', () => ({
  buildConfigFileFromAdminConfig: jest.fn(() => 'rebuilt-config'),
}));

jest.mock('@/lib/api-config-error', () => ({
  configConflictResponse: jest.fn(() => null),
}));

if (!(globalThis as any).Headers) {
  class MinimalHeaders {
    private store: Record<string, string> = {};

    constructor(init?: Record<string, string>) {
      Object.entries(init || {}).forEach(([key, value]) =>
        this.set(key, value),
      );
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

    constructor(
      body?: string,
      init?: { status?: number; headers?: Record<string, string> },
    ) {
      this.body = body || '';
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers || {});
    }

    static json(
      data: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) {
      const response = new MinimalResponse(JSON.stringify(data), init);
      response.headers.set('content-type', 'application/json');
      return response;
    }

    async json() {
      return this.body ? JSON.parse(this.body) : null;
    }
  }

  (globalThis as any).Response = MinimalResponse;
}

function createConfig() {
  return {
    ConfigFile: 'old-config',
    CustomCategories: [
      {
        name: '热门电影',
        type: 'movie' as const,
        query: '热门',
        from: 'config' as const,
        disabled: false,
      },
      {
        name: '热门剧集',
        type: 'tv' as const,
        query: '热门',
        from: 'custom' as const,
        disabled: false,
      },
    ],
  };
}

function createRequest(body: unknown) {
  return { json: async () => body } as NextRequest;
}

function getHandler() {
  const { POST } = require('../category/route');
  return POST as (request: NextRequest) => Promise<Response>;
}

describe('admin category route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue({ role: 'owner' });
    (saveConfig as jest.Mock).mockResolvedValue(undefined);
  });

  it('edits a category and rebuilds the config file', async () => {
    const config = createConfig();
    (getConfig as jest.Mock).mockResolvedValue(config);

    const response = await getHandler()(
      createRequest({
        action: 'edit',
        originalQuery: '热门',
        originalType: 'movie',
        name: '院线电影',
        type: 'movie',
        query: '院线',
      }),
    );

    expect(response.status).toBe(200);
    expect(config.CustomCategories[0]).toMatchObject({
      name: '院线电影',
      type: 'movie',
      query: '院线',
    });
    expect(buildConfigFileFromAdminConfig).toHaveBeenCalledWith(config);
    expect(config.ConfigFile).toBe('rebuilt-config');
    expect(saveConfig).toHaveBeenCalledWith(config);
  });

  it('deletes a config category after confirmation reaches the API', async () => {
    const config = createConfig();
    (getConfig as jest.Mock).mockResolvedValue(config);

    const response = await getHandler()(
      createRequest({ action: 'delete', query: '热门', type: 'movie' }),
    );

    expect(response.status).toBe(200);
    expect(config.CustomCategories).toHaveLength(1);
    expect(config.CustomCategories[0].type).toBe('tv');
    expect(buildConfigFileFromAdminConfig).toHaveBeenCalledWith(config);
    expect(config.ConfigFile).toBe('rebuilt-config');
    expect(saveConfig).toHaveBeenCalledWith(config);
  });
});
