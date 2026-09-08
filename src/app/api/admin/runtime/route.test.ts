import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { IMPORT_ADMIN_CONFIG } from '@/lib/__tests__/__fixtures__/import-admin-config';
import {
  ConfigConflictError,
  getConfig,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
} from '@/lib/runtime-params';

installWebPolyfills();

const mockRequireAdmin = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  isGuardFailure: (value: { response?: Response }) => !!value.response,
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  invalidateConfigCache: jest.fn(),
  saveConfig: jest.fn(),
  ConfigConflictError: class ConfigConflictError extends Error {},
}));

const { POST } = require('./route') as typeof import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body } as NextRequest;
}

describe('runtime parameter updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({ username: 'admin', role: 'admin' });
    jest.mocked(getConfig).mockResolvedValue({
      ...IMPORT_ADMIN_CONFIG,
      SiteConfig: {
        ...IMPORT_ADMIN_CONFIG.SiteConfig,
        VodPageTimeoutSeconds: 45,
      },
    });
    jest.mocked(saveConfig).mockImplementation(async (config) => config);
  });

  it('invalidates before reading and preserves parameters omitted by older clients', async () => {
    const response = await POST(request({ DanmakuRequestTimeoutSeconds: 25 }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(
      jest.mocked(invalidateConfigCache).mock.invocationCallOrder[0],
    ).toBeLessThan(jest.mocked(getConfig).mock.invocationCallOrder[0]);
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SiteConfig: expect.objectContaining({
          DanmakuRequestTimeoutSeconds: 25,
          DanmakuEpisodeLimit: 8000,
          VodPageTimeoutSeconds: 45,
          SiteName: 'IceTV',
        }),
      }),
    );
  });

  it('fills the timeout default when reading an older configuration', () => {
    expect(normalizeRuntimeParams({}).DanmakuRequestTimeoutSeconds).toBe(12);
    expect(DEFAULT_RUNTIME_PARAMS.DanmakuRequestTimeoutSeconds).toBe(12);
  });

  it.each([
    null,
    [],
    {},
    'invalid',
    { UnknownParameter: 1 },
    { DanmakuRequestTimeoutSeconds: 0 },
    { DanmakuRequestTimeoutSeconds: 61 },
    { DanmakuRequestTimeoutSeconds: 1.5 },
    { DanmakuRequestTimeoutSeconds: '12' },
    { DanmakuRequestTimeoutSeconds: Number.NaN },
    { DanmakuRequestTimeoutSeconds: Infinity },
  ])(
    'rejects invalid updates before reading or saving config: %p',
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(getConfig).not.toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed JSON without writing config', async () => {
    const response = await POST({
      json: async () => {
        throw new SyntaxError();
      },
    } as unknown as NextRequest);
    expect(response.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('requires admin access before reading the request body', async () => {
    const denied = new Response(null, { status: 403 });
    mockRequireAdmin.mockResolvedValue({ response: denied });
    const json = jest.fn();
    expect(await POST({ json } as unknown as NextRequest)).toBe(denied);
    expect(json).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('keeps optimistic configuration conflicts as 409 responses', async () => {
    jest.mocked(saveConfig).mockRejectedValueOnce(new ConfigConflictError());
    expect(
      (await POST(request({ DanmakuRequestTimeoutSeconds: 20 }))).status,
    ).toBe(409);
  });
});
