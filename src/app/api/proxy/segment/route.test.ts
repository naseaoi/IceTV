/** @jest-environment node */

import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';

import { resolveProxyUserAgent } from '@/app/api/proxy/utils';
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { isServerRelayPaused } from '@/lib/host-traffic.server';
import { resolveProxyAuthorization } from '@/lib/proxy-auth';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

jest.unmock('@/lib/upstream-resource-guard.server');
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(async () => ({ SiteConfig: {} })),
}));
jest.mock('@/lib/api-auth', () => ({ getOptionalActiveUser: jest.fn() }));
jest.mock('@/lib/host-traffic.server', () => ({
  isServerRelayPaused: jest.fn(async () => false),
  serverRelayPausedResponse: jest.requireActual('@/lib/host-traffic.server')
    .serverRelayPausedResponse,
}));
jest.mock('@/app/api/proxy/utils', () => ({
  getProxySourceKey: jest.requireActual('@/app/api/proxy/utils')
    .getProxySourceKey,
  resolveProxyUserAgent: jest.fn(
    jest.requireActual('@/app/api/proxy/utils').resolveProxyUserAgent,
  ),
}));
jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: jest.fn(async () => ({
    authorized: true,
    via: 'session',
    username: 'test-user',
  })),
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: () => undefined,
  fetchStreamThroughProxy: jest.fn(),
}));
jest.mock('@/lib/url-guard', () => ({
  UrlValidationError: jest.requireActual('@/lib/url-guard').UrlValidationError,
  validateProxyUrlForRequest: (url: string) => mockValidateProxyUrl(url),
  fetchWithUrlGuard: (
    url: string,
    init: {
      signal: AbortSignal;
      resourceContext: object;
      useProxyPool: boolean;
    },
  ) => {
    mockFetchOptions(init);
    return require('@/lib/upstream-resource-guard.server').withUpstreamResponse(
      url,
      mockOrigin,
      { ...init.resourceContext, signal: init.signal },
    );
  },
}));

const mockOrigin = jest.fn();
const mockFetchOptions = jest.fn();
const mockValidateProxyUrl = jest.fn();
installStreamPolyfills();
const { GET } =
  require('@/app/api/proxy/segment/route') as typeof import('@/app/api/proxy/segment/route');

function request(signal?: AbortSignal): NextRequest {
  return {
    url: 'http://localhost/api/proxy/segment?url=https%3A%2F%2Fup.example%2Fsegment.ts',
    headers: new Headers(),
    signal: signal ?? new AbortController().signal,
  } as NextRequest;
}

describe('segment shared resource integration', () => {
  let storage: LocalSqliteStorage;
  const originalLimit = process.env.UPSTREAM_MEDIA_USER_CONCURRENCY;
  beforeEach(() => {
    (getConfigForRead as jest.Mock).mockResolvedValue({ SiteConfig: {} });
    (resolveProxyAuthorization as jest.Mock).mockResolvedValue({
      authorized: true,
      via: 'session',
      username: 'test-user',
    });
    (getOptionalActiveUser as jest.Mock).mockReset();
    (isServerRelayPaused as jest.Mock).mockResolvedValue(false);
    storage = new LocalSqliteStorage(':memory:');
    jest
      .spyOn(db, 'getSharedResourceStore')
      .mockResolvedValue(storage.resources);
    process.env.UPSTREAM_MEDIA_USER_CONCURRENCY = '1';
    mockOrigin.mockReset().mockImplementation(
      async () =>
        new Response(new Uint8Array(16), {
          headers: { 'Content-Type': 'video/mp2t' },
        }),
    );
    mockValidateProxyUrl
      .mockReset()
      .mockImplementation(async (url: string) => ({ ok: true, url }));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLimit === undefined)
      delete process.env.UPSTREAM_MEDIA_USER_CONCURRENCY;
    else process.env.UPSTREAM_MEDIA_USER_CONCURRENCY = originalLimit;
    (storage as unknown as { db: Database.Database }).db.close();
  });

  it.each([false, true])(
    'reads config once and shares it with relay, UA and timeout (live=%s)',
    async (live) => {
      const config = {
        SiteConfig: {
          EnableLiveEntry: true,
          LiveAccess: 'all',
          ProxyRequestTimeoutSeconds: 17,
        },
        LiveConfig: [{ key: 'custom', ua: 'Custom UA' }],
      };
      (getConfigForRead as jest.Mock).mockClear().mockResolvedValue(config);
      (resolveProxyUserAgent as jest.Mock).mockClear();
      (isServerRelayPaused as jest.Mock).mockClear();
      mockFetchOptions.mockClear();
      const mediaRequest = request();
      Object.assign(mediaRequest, {
        url: `${mediaRequest.url}&source=custom&icetv-live=${live ? '1' : '0'}`,
      });
      const response = await GET(mediaRequest);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      expect(getConfigForRead).toHaveBeenCalledTimes(1);
      expect(isServerRelayPaused).toHaveBeenCalledWith(config);
      expect(resolveProxyUserAgent).toHaveBeenCalledWith('custom', config);
      expect(mockFetchOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 17_000,
          headers: expect.objectContaining({ 'User-Agent': 'Custom UA' }),
        }),
      );
    },
  );

  it.each([
    [false, true, true],
    [false, false, false],
    [false, undefined, false],
    [true, true, false],
  ])(
    'routes segments through the upstream pool only for VOD when enabled (live=%s, toggle=%s)',
    async (isLive, segmentsToggle, expected) => {
      (getConfigForRead as jest.Mock).mockResolvedValue({
        SiteConfig: {
          EnableLiveEntry: true,
          LiveAccess: 'all',
          UpstreamProxyPoolSegments: segmentsToggle,
        },
      });
      mockFetchOptions.mockClear();
      const mediaRequest = request();
      Object.assign(mediaRequest, {
        url: `${mediaRequest.url}&icetv-live=${isLive ? '1' : '0'}`,
      });
      const response = await GET(mediaRequest);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe(
        isLive
          ? 'no-cache'
          : 'private, max-age=3600, stale-while-revalidate=300',
      );
      await response.arrayBuffer();
      expect(mockFetchOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          useProxyPool: expected,
        }),
      );
    },
  );

  it.each(['session', 'signature'])(
    'denies live segments without a granting group (%s)',
    async (via) => {
      (getConfigForRead as jest.Mock).mockResolvedValue({
        SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups' },
        UserConfig: { Tags: [] },
      });
      (resolveProxyAuthorization as jest.Mock).mockResolvedValue({
        authorized: true,
        via,
        username: 'test-user',
      });
      (getOptionalActiveUser as jest.Mock).mockResolvedValue({
        username: 'test-user',
      });
      jest
        .spyOn(db, 'getUserAccess')
        .mockResolvedValue({ username: 'test-user', role: 'user', tags: [] });
      const liveRequest = request();
      Object.assign(liveRequest, { url: `${liveRequest.url}&icetv-live=1` });
      const response = await GET(liveRequest);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: '没有直播权限' });
      expect(mockOrigin).not.toHaveBeenCalled();
    },
  );

  it('allows a signed live request using its authenticated user group', async () => {
    (getConfigForRead as jest.Mock).mockResolvedValue({
      SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups' },
      UserConfig: { Tags: [{ name: 'live', allowLive: true }] },
    });
    (resolveProxyAuthorization as jest.Mock).mockResolvedValue({
      authorized: true,
      via: 'signature',
    });
    (getOptionalActiveUser as jest.Mock).mockResolvedValue({
      username: 'test-user',
    });
    jest.spyOn(db, 'getUserAccess').mockResolvedValue({
      username: 'test-user',
      role: 'user',
      tags: ['live'],
    });
    const liveRequest = request();
    Object.assign(liveRequest, { url: `${liveRequest.url}&icetv-live=1` });
    const response = await GET(liveRequest);
    expect(response.status).toBe(200);
    expect(getOptionalActiveUser).toHaveBeenCalledWith(liveRequest);
    await response.body!.cancel();
  });

  it('rejects relayed segments without contacting the origin while relay is paused', async () => {
    (isServerRelayPaused as jest.Mock).mockResolvedValue(true);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('x-icetv-relay-paused')).toBe('1');
    expect(mockOrigin).not.toHaveBeenCalled();
  });

  it('retains 404 for disabled live segments', async () => {
    (getConfigForRead as jest.Mock).mockResolvedValue({
      SiteConfig: { EnableLiveEntry: false },
    });
    const liveRequest = request();
    Object.assign(liveRequest, { url: `${liveRequest.url}&icetv-live=1` });
    const response = await GET(liveRequest);
    expect(response.status).toBe(404);
    expect(mockOrigin).not.toHaveBeenCalled();
  });

  it('returns 429 before upstream fetch while a user stream is active', async () => {
    const first = await GET(request());
    expect(first.status).toBe(200);
    const blocked = await GET(request());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(mockOrigin).toHaveBeenCalledTimes(1);
    await first.arrayBuffer();
    const next = await GET(request());
    expect(next.status).toBe(200);
    await next.body!.cancel();
  });

  it('logs the url validation reason without exposing it to the client', async () => {
    mockValidateProxyUrl.mockResolvedValueOnce({
      ok: false,
      reason: 'DNS lookup failed',
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('DNS');
    expect(console.warn).toHaveBeenCalledWith(
      '[proxy.failure]',
      expect.objectContaining({
        stage: 'validation',
        error: expect.objectContaining({ message: 'DNS lookup failed' }),
      }),
    );
    expect(mockOrigin).not.toHaveBeenCalled();
  });

  it('cancels rejected content and frees the slot', async () => {
    const cancel = jest.fn();
    mockOrigin.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    expect((await GET(request())).status).toBe(502);
    expect(cancel).toHaveBeenCalled();
    await (await GET(request())).body!.cancel();
  });

  it('cancels the upstream stream when the browser disconnects', async () => {
    const cancel = jest.fn();
    mockOrigin.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        headers: { 'Content-Type': 'video/mp2t' },
      }),
    );
    const parent = new AbortController();
    const response = await GET(request(parent.signal));
    const body = response.arrayBuffer();
    parent.abort(new Error('disconnected'));
    await expect(body).rejects.toThrow('disconnected');
    expect(cancel).toHaveBeenCalled();
    await (await GET(request())).body!.cancel();
  });
});
