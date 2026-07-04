/** @jest-environment node */

jest.mock('@/lib/config', () => {
  class ConfigConflictError extends Error {
    constructor() {
      super('配置已被其他操作更新，请刷新后重试');
      this.name = 'ConfigConflictError';
    }
  }
  return { ConfigConflictError };
});

if (!(globalThis as any).Headers) {
  class MinimalHeaders {
    private store: Record<string, string> = {};

    constructor(init?: Record<string, string>) {
      if (!init) return;
      Object.entries(init).forEach(([key, value]) => this.set(key, value));
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

describe('configConflictResponse', () => {
  it('maps ConfigConflictError to a 409 response', () => {
    const { configConflictResponse } = require('../api-config-error');
    const { ConfigConflictError } = require('../config');

    const response = configConflictResponse(new ConfigConflictError());

    expect(response?.status).toBe(409);
  });

  it('returns null for unrelated errors', () => {
    const { configConflictResponse } = require('../api-config-error');

    expect(configConflictResponse(new Error('boom'))).toBeNull();
    expect(configConflictResponse('nope')).toBeNull();
  });
});
