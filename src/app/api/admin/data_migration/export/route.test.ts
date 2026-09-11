/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

type ExportRouteModule = typeof import('./route');

type Limits = {
  maxFileBytes: number;
  maxDecompressedBytes: number;
};

const adminConfig = {
  SiteConfig: { SiteName: 'IceTV', SiteIcon: '' },
  UserConfig: { Users: [] },
};

function makeDb(searchHistory: string[]) {
  return {
    getAdminConfig: jest.fn().mockResolvedValue(adminConfig),
    getAllUsersWithPasswords: jest.fn().mockResolvedValue({}),
    getAllSourceRouteStatBuckets: jest.fn().mockResolvedValue([]),
    getAllInviteCodeUsage: jest.fn().mockResolvedValue({}),
    getAllUsers: jest.fn().mockResolvedValue([]),
    getAllPlayRecords: jest.fn().mockResolvedValue({}),
    getAllFavorites: jest.fn().mockResolvedValue({}),
    getSearchHistory: jest.fn().mockResolvedValue(searchHistory),
    getAllSkipConfigs: jest.fn().mockResolvedValue({}),
    getAllPlaybackSessions: jest.fn().mockResolvedValue([]),
    getUserMessageState: jest.fn().mockResolvedValue(null),
    getDanmakuEnabledPreference: jest.fn().mockResolvedValue(null),
    getUserLastActive: jest.fn().mockResolvedValue(null),
  };
}

async function loadRoute(limits: Limits, searchHistory: string[] = []) {
  jest.resetModules();
  installWebPolyfills();
  jest.doMock('@/lib/api-auth', () => ({
    isGuardFailure: jest.fn(() => false),
    requireOwner: jest.fn().mockResolvedValue({ username: 'owner-1' }),
  }));
  jest.doMock('@/lib/db', () => ({ db: makeDb(searchHistory) }));
  jest.doMock('@/lib/env.server', () => ({
    getOwnerUsername: jest.fn(() => 'owner-1'),
  }));
  jest.doMock('@/lib/site-icon-storage.server', () => ({
    readSiteIconForBackup: jest.fn(() => null),
  }));
  jest.doMock('@/lib/data-migration-limits', () => ({
    formatBytes: jest.requireActual('@/lib/data-migration-limits').formatBytes,
    MAX_BACKUP_DECOMPRESSED_BYTES: limits.maxDecompressedBytes,
    MAX_BACKUP_FILE_BYTES: limits.maxFileBytes,
  }));

  return require('./route') as ExportRouteModule;
}

function makeRequest(password: unknown = 'strong-password') {
  return {
    json: jest.fn().mockResolvedValue({ password }),
  } as unknown as NextRequest;
}

describe('data migration export route', () => {
  afterEach(() => {
    jest.dontMock('@/lib/api-auth');
    jest.dontMock('@/lib/db');
    jest.dontMock('@/lib/env.server');
    jest.dontMock('@/lib/site-icon-storage.server');
    jest.dontMock('@/lib/data-migration-limits');
    jest.restoreAllMocks();
  });

  it('导出成功返回加密附件', async () => {
    const { POST } = await loadRoute({
      maxDecompressedBytes: 50 * 1024 * 1024,
      maxFileBytes: 25 * 1024 * 1024,
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
    expect(response.headers.get('Content-Disposition')).toMatch(
      /icetv-backup-\d{8}-\d{6}\.dat/,
    );
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  it('原始数据超过解压上限时拒绝导出', async () => {
    const { POST } = await loadRoute(
      { maxDecompressedBytes: 512, maxFileBytes: 25 * 1024 * 1024 },
      Array.from({ length: 100 }, (_, i) => `keyword-${i}`),
    );

    const response = await POST(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error).toMatch(/超过备份上限 512 B/);
  });

  it('成品文件超过导入上限时拒绝导出', async () => {
    const { POST } = await loadRoute(
      { maxDecompressedBytes: 50 * 1024 * 1024, maxFileBytes: 16 },
      ['keyword'],
    );

    const response = await POST(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error).toMatch(/超过导入上限 16 B/);
  });

  it('500 响应不暴露内部错误', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await loadRoute({
      maxDecompressedBytes: 50 * 1024 * 1024,
      maxFileBytes: 25 * 1024 * 1024,
    });
    const request = {
      json: jest.fn().mockResolvedValue({ password: 'strong-password' }),
    } as unknown as NextRequest;
    const { db } = require('@/lib/db') as {
      db: { getAllUsersWithPasswords: jest.Mock };
    };
    db.getAllUsersWithPasswords.mockRejectedValue(
      new Error('ENOENT: /srv/icetv/data/internal.db'),
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: '导出失败' });
    expect(errorSpy).toHaveBeenCalledWith('数据导出失败:', expect.any(Error));
  });

  it('请求体不是 JSON 时返回 400', async () => {
    const { POST } = await loadRoute({
      maxDecompressedBytes: 50 * 1024 * 1024,
      maxFileBytes: 25 * 1024 * 1024,
    });
    const request = {
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('请求体无效');
  });

  it('缺少密码时拒绝导出', async () => {
    const { POST } = await loadRoute({
      maxDecompressedBytes: 50 * 1024 * 1024,
      maxFileBytes: 25 * 1024 * 1024,
    });

    const response = await POST(makeRequest(''));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('请提供加密密码');
  });
});
