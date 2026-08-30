/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: jest.fn(),
  },
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: jest.fn(),
}));

installWebPolyfills();

function createRequest(username: string, ip = '10.0.0.1') {
  const url = new URL('http://localhost/api/register/check-username');
  url.searchParams.set('username', username);

  return {
    nextUrl: url,
    headers: new Headers({ 'x-real-ip': ip }),
  } as unknown as NextRequest;
}

function loadRoute() {
  let route: { GET: (request: NextRequest) => Promise<Response> };
  jest.isolateModules(() => {
    route = require('./route');
  });
  return route!;
}

describe('check-username route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getOwnerUsername as jest.Mock).mockReturnValue('owner');
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: { OpenRegister: true },
    });
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);
  });

  it('reports an available username', async () => {
    const { GET } = loadRoute();

    const response = await GET(createRequest(' Demo-User '));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: true });
    expect(db.checkUserExist).toHaveBeenCalledWith('demo-user');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports a taken username', async () => {
    (db.checkUserExist as jest.Mock).mockResolvedValue(true);
    const { GET } = loadRoute();

    const response = await GET(createRequest('demo-user'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      available: false,
      error: '用户名已被占用',
    });
  });

  it('rejects an invalid username without touching the database', async () => {
    const { GET } = loadRoute();

    const response = await GET(createRequest('ab'));

    expect(response.status).toBe(400);
    expect(db.checkUserExist).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('rejects an empty username', async () => {
    const { GET } = loadRoute();

    const response = await GET(createRequest('   '));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '用户名不能为空',
    });
    expect(db.checkUserExist).not.toHaveBeenCalled();
  });

  it('returns 403 when registration is closed', async () => {
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: { OpenRegister: false },
    });
    const { GET } = loadRoute();

    const response = await GET(createRequest('demo-user'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: '当前未开放注册' });
    expect(db.checkUserExist).not.toHaveBeenCalled();
  });

  it('marks the owner username as unavailable without querying the database', async () => {
    const { GET } = loadRoute();

    const response = await GET(createRequest('Owner'));

    await expect(response.json()).resolves.toEqual({
      available: false,
      error: '该用户名不可注册',
    });
    expect(db.checkUserExist).not.toHaveBeenCalled();
  });

  it('rate limits repeated checks from the same ip', async () => {
    const { GET } = loadRoute();

    for (let i = 0; i < 30; i += 1) {
      const allowed = await GET(createRequest(`demo-user-${i}`));
      expect(allowed.status).toBe(200);
    }

    const blocked = await GET(createRequest('demo-user-30'));

    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({
      error: '检测过于频繁，请稍后再试',
    });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('keeps rate limit buckets separate per ip', async () => {
    const { GET } = loadRoute();

    for (let i = 0; i < 30; i += 1) {
      await GET(createRequest(`demo-user-${i}`, '10.0.0.1'));
    }

    const otherIp = await GET(createRequest('demo-user', '10.0.0.2'));

    expect(otherIp.status).toBe(200);
  });

  it('returns 500 when the database lookup fails', async () => {
    (db.checkUserExist as jest.Mock).mockRejectedValue(new Error('db down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = loadRoute();

    const response = await GET(createRequest('demo-user'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: '用户名检测失败',
    });
    errorSpy.mockRestore();
  });
});
