/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGetDanmakuEnabledPreference = jest.fn();
const mockSetDanmakuEnabledPreference = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/db', () => ({
  db: {
    getDanmakuEnabledPreference: (...args: unknown[]) =>
      mockGetDanmakuEnabledPreference(...args),
    setDanmakuEnabledPreference: (...args: unknown[]) =>
      mockSetDanmakuEnabledPreference(...args),
  },
}));

const { GET, PUT } = require('./route') as typeof import('./route');

function createRequest(body?: unknown): NextRequest {
  if (arguments.length === 0) {
    return new Request('http://localhost/api/danmaku/settings') as NextRequest;
  }
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('danmaku settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDanmakuEnabledPreference.mockResolvedValue(null);
    mockSetDanmakuEnabledPreference.mockResolvedValue(undefined);
  });

  it('按账号读取开关并禁止缓存', async () => {
    mockGetDanmakuEnabledPreference.mockResolvedValue(true);

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetDanmakuEnabledPreference).toHaveBeenCalledWith('demo');
  });

  it('严格校验并保存布尔开关', async () => {
    const response = await PUT(createRequest({ enabled: false }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false });
    expect(mockSetDanmakuEnabledPreference).toHaveBeenCalledWith('demo', false);
  });

  it('拒绝非布尔开关', async () => {
    const response = await PUT(createRequest({ enabled: 'false' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'enabled 必须是布尔值',
    });
    expect(mockSetDanmakuEnabledPreference).not.toHaveBeenCalled();
  });

  it('拒绝无效 JSON', async () => {
    const request = {
      json: jest.fn().mockRejectedValue(new SyntaxError('invalid json')),
    } as unknown as NextRequest;

    const response = await PUT(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '无效的 JSON' });
  });
});
