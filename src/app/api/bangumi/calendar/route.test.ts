/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

type CalendarRouteModule = typeof import('./route');

function createRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url),
  } as NextRequest;
}

async function loadRoute(getBangumiCalendarData: jest.Mock) {
  jest.resetModules();
  installWebPolyfills();
  jest.doMock('@/features/bangumi/lib/bangumi', () => ({
    getBangumiCalendarData,
  }));
  jest.doMock('@/lib/api-auth', () => ({
    requireActiveUser: jest
      .fn()
      .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
    isGuardFailure: (result: object) => 'response' in result,
  }));
  return require('./route') as CalendarRouteModule;
}

describe('bangumi calendar route', () => {
  afterEach(() => {
    jest.dontMock('@/features/bangumi/lib/bangumi');
    jest.dontMock('@/lib/api-auth');
    jest.restoreAllMocks();
  });

  it('returns 400 for unsupported source', async () => {
    const getBangumiCalendarData = jest.fn();
    const { GET } = await loadRoute(getBangumiCalendarData);

    const response = await GET(
      createRequest('http://localhost/api/bangumi/calendar?source=client'),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '不支持的 Bangumi 数据源' });
    expect(getBangumiCalendarData).not.toHaveBeenCalled();
  });

  it('returns 502 when calendar loading fails', async () => {
    const getBangumiCalendarData = jest
      .fn()
      .mockRejectedValue(new Error('network failed'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { GET } = await loadRoute(getBangumiCalendarData);

    const response = await GET(
      createRequest('http://localhost/api/bangumi/calendar'),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: '获取 Bangumi 日历失败' });
    expect(errorSpy).toHaveBeenCalledWith(
      'Bangumi 日历接口失败:',
      expect.any(Error),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[server-proxy.failure]',
      expect.objectContaining({
        kind: 'bangumi-data',
        reason: 'network failed',
      }),
    );
  });
});
