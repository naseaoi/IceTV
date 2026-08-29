/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getConfigForRead, invalidateConfigCache } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import {
  releaseInviteCode,
  reserveInviteCode,
} from '@/lib/invite-code-consumption.server';

jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(),
  invalidateConfigCache: jest.fn(),
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

jest.mock('@/lib/invite-code-consumption.server', () => ({
  reserveInviteCode: jest.fn(),
  releaseInviteCode: jest.fn(),
}));

installWebPolyfills();

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
      RequireInviteCode: false,
      InviteCodes: [] as Array<Record<string, unknown>>,
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };
}

let requestSeq = 0;

// 每个请求换一个 IP，避免测试之间互相触发限流
function createRequest(body: unknown, ip?: string) {
  const clientIp = ip || `10.0.0.${(requestSeq += 1)}`;
  return {
    json: async () => body,
    headers: new Headers({ 'x-forwarded-for': clientIp }),
  } as unknown as NextRequest;
}

describe('register route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getOwnerUsername as jest.Mock).mockReturnValue('owner');
    (getConfigForRead as jest.Mock).mockResolvedValue(createConfig());
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
    (db.registerUser as jest.Mock).mockResolvedValue(undefined);
    (reserveInviteCode as jest.Mock).mockResolvedValue(true);
    (releaseInviteCode as jest.Mock).mockResolvedValue(undefined);
  });

  function withInviteCode(overrides: Record<string, unknown> = {}) {
    const config = createConfig();
    config.UserConfig.RequireInviteCode = true;
    config.UserConfig.InviteCodes = [
      {
        code: 'WELCOME-2026',
        createdAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
        createdBy: 'admin',
        ...overrides,
      },
    ];
    (getConfigForRead as jest.Mock).mockResolvedValue(config);
    return config;
  }

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
  });

  it('注册成功只失效配置缓存，不回写配置', async () => {
    const { POST } = require('./route');

    const response = await POST(
      createRequest({ username: 'demo-user', password: 'strong-password' }),
    );

    expect(response.status).toBe(200);
    expect(invalidateConfigCache).toHaveBeenCalledTimes(1);
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

  it('不要求邀请码时不占用名额', async () => {
    const { POST } = require('./route');

    await POST(
      createRequest({ username: 'demo-user', password: 'strong-password' }),
    );

    expect(reserveInviteCode).not.toHaveBeenCalled();
  });

  it('要求邀请码时占用名额后建号', async () => {
    withInviteCode({ maxUses: 2, usedCount: 0 });
    const { POST } = require('./route');

    const response = await POST(
      createRequest({
        username: 'demo-user',
        password: 'strong-password',
        inviteCode: 'welcome-2026',
      }),
    );

    expect(response.status).toBe(200);
    expect(reserveInviteCode).toHaveBeenCalledWith('welcome-2026');
    expect(db.registerUser).toHaveBeenCalled();
    expect(releaseInviteCode).not.toHaveBeenCalled();
  });

  it('邀请码缺失时拒绝且不查库', async () => {
    withInviteCode();
    const { POST } = require('./route');

    const response = await POST(
      createRequest({ username: 'demo-user', password: 'strong-password' }),
    );

    expect(response.status).toBe(403);
    expect(db.checkUserExist).not.toHaveBeenCalled();
    expect(reserveInviteCode).not.toHaveBeenCalled();
  });

  it('邀请码已用尽时拒绝', async () => {
    withInviteCode({ maxUses: 1, usedCount: 1 });
    const { POST } = require('./route');

    const response = await POST(
      createRequest({
        username: 'demo-user',
        password: 'strong-password',
        inviteCode: 'WELCOME-2026',
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: '邀请码无效、已过期或已用尽',
    });
    expect(response.status).toBe(403);
    expect(db.registerUser).not.toHaveBeenCalled();
  });

  it('并发抢占失败时拒绝且不建号', async () => {
    withInviteCode({ maxUses: 1, usedCount: 0 });
    (reserveInviteCode as jest.Mock).mockResolvedValue(false);
    const { POST } = require('./route');

    const response = await POST(
      createRequest({
        username: 'demo-user',
        password: 'strong-password',
        inviteCode: 'WELCOME-2026',
      }),
    );

    expect(response.status).toBe(403);
    expect(db.registerUser).not.toHaveBeenCalled();
    expect(releaseInviteCode).not.toHaveBeenCalled();
  });

  it('建号失败时回滚已占用的次数', async () => {
    withInviteCode({ maxUses: 2, usedCount: 0 });
    (db.registerUser as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const { POST } = require('./route');

    const response = await POST(
      createRequest({
        username: 'demo-user',
        password: 'strong-password',
        inviteCode: 'WELCOME-2026',
      }),
    );

    expect(response.status).toBe(500);
    expect(releaseInviteCode).toHaveBeenCalledWith('WELCOME-2026');
  });

  it('不要求邀请码时建号失败不触发回滚', async () => {
    (db.registerUser as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const { POST } = require('./route');

    await POST(
      createRequest({ username: 'demo-user', password: 'strong-password' }),
    );

    expect(releaseInviteCode).not.toHaveBeenCalled();
  });

  it('同一 IP 超出配额后返回 429', async () => {
    const { POST } = require('./route');
    const ip = '203.0.113.7';

    for (let i = 0; i < 10; i += 1) {
      const ok = await POST(
        createRequest(
          { username: `demo-user-${i}`, password: 'strong-password' },
          ip,
        ),
      );
      expect(ok.status).toBe(200);
    }

    const blocked = await POST(
      createRequest(
        { username: 'demo-user-x', password: 'strong-password' },
        ip,
      ),
    );

    await expect(blocked.json()).resolves.toEqual({
      error: '注册过于频繁，请稍后再试',
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(db.registerUser).toHaveBeenCalledTimes(10);
  });
});
