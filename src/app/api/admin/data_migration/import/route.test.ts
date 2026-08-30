/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

type ImportRouteModule = typeof import('./route');

async function loadRoute() {
  jest.resetModules();
  installWebPolyfills();
  jest.doMock('@/lib/api-auth', () => ({
    isGuardFailure: jest.fn(() => false),
    requireOwner: jest.fn().mockResolvedValue({ username: 'owner-1' }),
  }));
  jest.doMock('@/lib/data-import', () => ({
    ImportValidationError: class ImportValidationError extends Error {
      constructor(
        message: string,
        public readonly status = 400,
      ) {
        super(message);
      }
    },
    parseImportData: jest.fn(),
  }));
  jest.doMock('@/lib/db', () => ({
    db: {
      replaceAllData: jest.fn(),
    },
  }));
  jest.doMock('@/lib/config', () => ({
    setCachedConfig: jest.fn(),
  }));
  jest.doMock('@/lib/site-icon-storage.server', () => ({
    restoreSiteIconFromBackup: jest.fn(),
  }));

  return require('./route') as ImportRouteModule;
}

describe('data migration import route', () => {
  afterEach(() => {
    jest.dontMock('@/lib/api-auth');
    jest.dontMock('@/lib/data-import');
    jest.dontMock('@/lib/db');
    jest.dontMock('@/lib/config');
    jest.dontMock('@/lib/site-icon-storage.server');
    jest.restoreAllMocks();
  });

  it('does not expose internal errors in 500 responses', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await loadRoute();
    const request = {
      formData: jest.fn().mockRejectedValue(new Error('internal secret path')),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: '导入失败' });
    expect(errorSpy).toHaveBeenCalledWith('数据导入失败:', expect.any(Error));
  });
});
