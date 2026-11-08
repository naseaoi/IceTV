/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { getConfig, saveConfig } from '@/lib/config';

import { installWebPolyfills } from '../../test-utils/web-polyfills';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getConfigSubscription: jest.fn().mockResolvedValue({
      ConfigFile: 'old-config',
      ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    }),
  },
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  invalidateConfigCache: jest.fn(),
  saveConfig: jest.fn(),
}));

jest.mock('@/lib/config-file-json', () => ({
  buildConfigFileFromAdminConfig: jest.fn(() => 'rebuilt-config'),
  removeConfigFileEntries: jest.fn((file: string) => file),
}));

jest.mock('@/lib/api-config-error', () => ({
  configConflictResponse: jest.fn(() => null),
}));

jest.mock('@/lib/catalog-favorites', () => ({
  isCatalogFavoriteSource: jest.fn(() => false),
}));

jest.mock('@/lib/url-guard', () => ({
  validateProxyUrlForRequest: jest.fn(),
}));

function createConfig() {
  return {
    SourceConfig: [
      { key: 'a', name: 'A', api: 'https://a.example', from: 'custom' },
      {
        key: 'b',
        name: 'B',
        api: 'https://b.example',
        from: 'custom',
        adminOnly: true,
      },
      { key: 'c', name: 'C', api: 'https://c.example', from: 'custom' },
    ] as Array<Record<string, unknown>>,
  };
}

function createRequest(body: unknown) {
  return { json: async () => body } as NextRequest;
}

function getHandler() {
  const { POST } = require('../source/route');
  return POST as (request: NextRequest) => Promise<Response>;
}

describe('admin source route admin-only visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue({ role: 'admin' });
    (saveConfig as jest.Mock).mockResolvedValue(undefined);
  });

  it('marks a single source as admin-only and clears the flag again', async () => {
    const config = createConfig();
    (getConfig as jest.Mock).mockResolvedValue(config);

    const on = await getHandler()(
      createRequest({ action: 'set_admin_only', key: 'a', adminOnly: true }),
    );
    expect(on.status).toBe(200);
    expect(config.SourceConfig[0].adminOnly).toBe(true);

    const off = await getHandler()(
      createRequest({ action: 'set_admin_only', key: 'b', adminOnly: false }),
    );
    expect(off.status).toBe(200);
    expect('adminOnly' in config.SourceConfig[1]).toBe(false);
    expect(saveConfig).toHaveBeenCalledTimes(2);
  });

  it('applies the batch flag only to the selected sources', async () => {
    const config = createConfig();
    (getConfig as jest.Mock).mockResolvedValue(config);

    const response = await getHandler()(
      createRequest({
        action: 'batch_set_admin_only',
        keys: ['a', 'c'],
        adminOnly: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(config.SourceConfig.map((s) => s.adminOnly)).toEqual([
      true,
      true,
      true,
    ]);
    expect(saveConfig).toHaveBeenCalledWith(config, expect.anything());
  });

  it('rejects invalid input without saving', async () => {
    (getConfig as jest.Mock).mockResolvedValue(createConfig());

    const cases = [
      [{ action: 'set_admin_only', key: 'a', adminOnly: 'yes' }, 400],
      [{ action: 'set_admin_only', adminOnly: true }, 400],
      [{ action: 'set_admin_only', key: 'missing', adminOnly: true }, 404],
      [{ action: 'batch_set_admin_only', keys: [], adminOnly: true }, 400],
      [{ action: 'batch_set_admin_only', keys: ['a'] }, 400],
    ] as const;
    for (const [body, status] of cases) {
      const response = await getHandler()(createRequest(body));
      expect(response.status).toBe(status);
    }
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
