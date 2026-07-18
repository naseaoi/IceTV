/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import type { requireActiveUser as requireActiveUserType } from '@/lib/api-auth';
import type {
  getAvailableApiSites as getAvailableApiSitesType,
  getConfigForRead as getConfigForReadType,
} from '@/lib/config';
import type { db as dbType } from '@/lib/db';

installWebPolyfills();

const mockRequireActiveUser = jest.fn();
const mockGetAvailableApiSites = jest.fn();
const mockGetConfigForRead = jest.fn();
const mockRecordSourceRouteStat = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockRequireActiveUser(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: (...args: unknown[]) =>
    mockGetAvailableApiSites(...args),
  getConfigForRead: (...args: unknown[]) => mockGetConfigForRead(...args),
}));

jest.mock('@/lib/db', () => ({
  db: {
    recordSourceRouteStat: (...args: unknown[]) =>
      mockRecordSourceRouteStat(...args),
  },
}));

type RequireActiveUser = typeof requireActiveUserType;
type GetAvailableApiSites = typeof getAvailableApiSitesType;
type GetConfigForRead = typeof getConfigForReadType;
type RecordSourceRouteStat = typeof dbType.recordSourceRouteStat;

function getHandlers() {
  const { GET: getLiveSources } = require('@/app/api/live/sources/route');
  const { GET: getProxyModes } = require('@/app/api/proxy-modes/route');
  const {
    POST: saveSourceRouteStat,
  } = require('@/app/api/source-route-stats/route');

  return {
    getLiveSources: getLiveSources as (
      request: NextRequest,
    ) => Promise<Response>,
    getProxyModes: getProxyModes as (request: NextRequest) => Promise<Response>,
    saveSourceRouteStat: saveSourceRouteStat as (
      request: NextRequest,
    ) => Promise<Response>,
  };
}

function createRequest(url: string, body?: unknown): NextRequest {
  return {
    url,
    json: async () => body,
  } as NextRequest;
}

function setGuestSession() {
  mockRequireActiveUser.mockResolvedValue({
    response: Response.json(
      { error: 'Unauthorized' },
      { status: 401 },
    ) as never,
  } satisfies Awaited<ReturnType<RequireActiveUser>>);
}

describe('游客受保护接口', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setGuestSession();
  });

  it.each([
    [
      '直播源列表',
      () => getHandlers().getLiveSources(createRequest('http://test/live')),
    ],
    [
      '代理模式',
      () => getHandlers().getProxyModes(createRequest('http://test/proxy')),
    ],
    [
      '播放路由统计',
      () =>
        getHandlers().saveSourceRouteStat(
          createRequest('http://test/stats', {
            stat: {
              source: 'source-a',
              routeMode: 'browser',
              success: true,
              eventAt: Date.now(),
            },
          }),
        ),
    ],
  ])('%s拒绝游客且不读取业务数据', async (_label, request) => {
    const response = await request();

    expect(response.status).toBe(401);
    expect(mockGetConfigForRead).not.toHaveBeenCalled();
    expect(mockRecordSourceRouteStat).not.toHaveBeenCalled();
  });

  it('代理模式只返回当前用户可用源', async () => {
    mockRequireActiveUser.mockResolvedValue({
      username: 'alice',
      isOwner: false,
      role: 'user',
    } satisfies Awaited<ReturnType<RequireActiveUser>>);
    mockGetConfigForRead.mockResolvedValue({
      SourceConfig: [
        { key: 'allowed', proxyMode: 'server' },
        { key: 'hidden', proxyMode: 'browser' },
      ],
    } as Awaited<ReturnType<GetConfigForRead>>);
    mockGetAvailableApiSites.mockResolvedValue([
      { key: 'allowed', name: '可用源', api: 'https://example.com' },
    ] satisfies Awaited<ReturnType<GetAvailableApiSites>>);

    const response = await getHandlers().getProxyModes(
      createRequest('http://test/api/proxy-modes'),
    );

    await expect(response.json()).resolves.toEqual({ allowed: 'server' });
  });

  it('拒绝写入用户无权使用的源站统计', async () => {
    mockRequireActiveUser.mockResolvedValue({
      username: 'alice',
      isOwner: false,
      role: 'user',
    } satisfies Awaited<ReturnType<RequireActiveUser>>);
    mockGetConfigForRead.mockResolvedValue(
      {} as Awaited<ReturnType<GetConfigForRead>>,
    );
    mockGetAvailableApiSites.mockResolvedValue(
      [] satisfies Awaited<ReturnType<GetAvailableApiSites>>,
    );

    const response = await getHandlers().saveSourceRouteStat(
      createRequest('http://test/api/source-route-stats', {
        stat: {
          source: 'hidden',
          routeMode: 'server',
          success: true,
          eventAt: Date.now(),
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(
      mockRecordSourceRouteStat as jest.MockedFunction<RecordSourceRouteStat>,
    ).not.toHaveBeenCalled();
  });
});
