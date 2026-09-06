/** @jest-environment node */

import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { db } from '@/lib/db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

jest.unmock('@/lib/upstream-resource-guard.server');
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({ SiteConfig: {} }),
}));
jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabled: async () => true,
}));
jest.mock('@/app/api/proxy/utils', () => ({
  getProxySourceKey: () => null,
  resolveProxyUserAgent: async () => 'IceTV Test',
}));
jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: async () => ({
    authorized: true,
    via: 'session',
    username: 'test-user',
  }),
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: () => undefined,
  fetchStreamThroughProxy: jest.fn(),
}));
jest.mock('@/lib/url-guard', () => ({
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
  fetchWithUrlGuard: (
    url: string,
    init: { signal: AbortSignal; resourceContext: object },
  ) =>
    require('@/lib/upstream-resource-guard.server').withUpstreamResponse(
      url,
      mockOrigin,
      { ...init.resourceContext, signal: init.signal },
    ),
}));

const mockOrigin = jest.fn();
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
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLimit === undefined)
      delete process.env.UPSTREAM_MEDIA_USER_CONCURRENCY;
    else process.env.UPSTREAM_MEDIA_USER_CONCURRENCY = originalLimit;
    (storage as unknown as { db: Database.Database }).db.close();
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
