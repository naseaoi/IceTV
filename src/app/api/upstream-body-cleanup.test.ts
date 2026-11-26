/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { recordSourceProxyFailure } from '@/lib/source-proxy-failures.server';

installWebPolyfills();
jest.mock('@/lib/source-proxy-failures.server', () => ({
  recordSourceProxyFailure: jest.fn(),
}));
const mockFetch = jest.fn();
const mockAuthorization = jest.fn(async () => ({
  authorized: true,
  via: 'session',
  username: 'owner',
}));

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: () => false,
  requireActiveUser: async () => ({ username: 'owner' }),
  requireOwner: async () => ({ username: 'owner' }),
  getOptionalActiveUser: async () => ({ username: 'owner' }),
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({
    SiteConfig: { EnableLiveEntry: true },
    LiveConfig: [{ key: 'live', url: 'https://example.com/live.m3u' }],
  }),
}));
jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabledInConfig: () => true,
}));
jest.mock('@/lib/live-access.server', () => ({
  canUserWatchLive: async () => true,
}));
jest.mock('@/lib/proxy-auth', () => ({
  authorizeProxyRequest: async () => null,
  resolveProxyAuthorization: () => mockAuthorization(),
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetch(...args),
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
  UrlValidationError: class extends Error {},
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: () => undefined,
  fetchResponseThroughProxy: jest.fn(),
}));
jest.mock('@/lib/config-subscription', () => ({
  decodeConfigSubscriptionContent: jest.fn(),
  readConfigSubscriptionText: jest.fn(),
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  recordServerProxyFailure: jest.fn(),
  requireServerProxyQuota: () => null,
}));
jest.mock('@/lib/cover-image-resize', () => ({
  CoverImageResizeParamError: class extends Error {},
  parseCoverImageResizeOptions: () => null,
  downloadAndResizeCoverImage: jest.fn(),
  MAX_COVER_IMAGE_BYTES: 10 * 1024 * 1024,
}));
jest.mock('@/lib/cover-image-resize-cache.server', () => ({
  loadResizedCoverImage: jest.fn(),
}));

const keyRoute =
  require('./proxy/key/route') as typeof import('./proxy/key/route');
const logoRoute =
  require('./proxy/logo/route') as typeof import('./proxy/logo/route');
const precheckRoute =
  require('./live/precheck/route') as typeof import('./live/precheck/route');
const subscriptionRoute =
  require('./admin/config_subscription/fetch/route') as typeof import('./admin/config_subscription/fetch/route');
const imageRoute =
  require('./image-proxy/route') as typeof import('./image-proxy/route');
const request = {
  url: 'http://localhost/api/proxy?url=https://example.com/image.jpg&source=live',
  json: async () => ({ url: 'https://example.com/config' }),
} as NextRequest;

it.each([
  ['key', keyRoute.GET, 503],
  ['logo', logoRoute.GET, 502],
  ['precheck', precheckRoute.GET, 500],
  ['subscription', subscriptionRoute.POST, 503],
] as const)(
  '%s 错误响应取消正文且保持状态码',
  async (_name, handle, status) => {
    const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      body: { cancel },
    });
    expect((await handle(request)).status).toBe(status);
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ['session', false, 'user:owner'],
  ['signature', false, 'ip:203.0.113.8'],
  ['session', true, 'user:owner'],
] as const)(
  'key forwards %s identity and live=%s pool selection',
  async (via, isLive, identity) => {
    mockAuthorization.mockResolvedValueOnce({
      authorized: true,
      via,
      username: 'owner',
    });
    mockFetch.mockClear().mockResolvedValue({
      ok: false,
      status: 502,
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    });
    const response = await keyRoute.GET({
      url: `${request.url}&icetv-live=${isLive ? '1' : '0'}`,
      headers: new Headers({ 'x-real-ip': '203.0.113.8' }),
    } as NextRequest);
    expect(response.status).toBe(502);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/image.jpg',
      expect.objectContaining({
        resourceContext: { identity },
        useProxyPool: !isLive,
      }),
    );
  },
);

it.each([
  ['logo', logoRoute.GET, true],
  ['precheck', precheckRoute.GET, false],
] as const)(
  '%s 直播元数据沿用对应出口策略',
  async (_name, handle, useProxyPool) => {
    mockFetch.mockClear().mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    });
    await handle({
      ...request,
      url: request.url.replace('image.jpg', 'pool.jpg'),
    } as NextRequest);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/pool.jpg',
      expect.objectContaining({ useProxyPool }),
    );
  },
);

it('logo 成功响应只允许浏览器私有缓存', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'image/png' }),
    body: null,
    arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
  });
  const response = await logoRoute.GET({
    ...request,
    url: request.url.replace('image.jpg', 'success.jpg'),
  } as NextRequest);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
  expect(response.headers.has('CDN-Cache-Control')).toBe(false);
  expect(response.headers.has('Vercel-CDN-Cache-Control')).toBe(false);
});

it.each(['network', 'http'])(
  'logo %s 失败短期缓存且不重复回源',
  async (kind) => {
    mockFetch.mockReset();
    if (kind === 'network')
      mockFetch.mockRejectedValue(new Error('connection failed'));
    else
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        body: { cancel: jest.fn() },
      });
    const target = {
      ...request,
      url: request.url.replace('image.jpg', `negative-${kind}.jpg`),
    } as NextRequest;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await logoRoute.GET(target);
      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe(
        'private, max-age=120',
      );
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_001);
    await logoRoute.GET(target);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  },
);

it('直播预检成功仅读取响应头并取消正文', async () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'video/mp4' }),
    body: { cancel },
  });
  expect(await (await precheckRoute.GET(request)).json()).toEqual({
    success: true,
    type: 'mp4',
  });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('图片大小预检超限取消正文并返回 413', async () => {
  const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'image/jpeg',
      'content-length': String(10 * 1024 * 1024 + 1),
    }),
    body: { cancel },
  });
  expect((await imageRoute.GET(request)).status).toBe(413);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('records final key failures once for HTTP and transport errors', async () => {
  (recordSourceProxyFailure as jest.Mock).mockClear();
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 404,
    body: { cancel: jest.fn().mockResolvedValue(undefined) },
  });
  expect((await keyRoute.GET(request)).status).toBe(404);
  expect(recordSourceProxyFailure).toHaveBeenCalledTimes(1);
  expect(recordSourceProxyFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      route: 'key',
      source: 'live',
      reason: 'upstream-http',
      upstreamStatus: 404,
      isLive: false,
    }),
  );
  mockFetch.mockRejectedValueOnce(new Error('upstream timeout'));
  expect((await keyRoute.GET(request)).status).toBe(500);
  expect(recordSourceProxyFailure).toHaveBeenCalledTimes(2);
  expect(recordSourceProxyFailure).toHaveBeenLastCalledWith(
    expect.objectContaining({ route: 'key', reason: 'upstream-timeout' }),
  );
});
