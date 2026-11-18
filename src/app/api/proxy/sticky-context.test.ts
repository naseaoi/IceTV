/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { createFragmentMemoryCache } from '@/features/play/lib/fragmentMemoryCache';
import { normalizeSegmentCacheKey } from '@/lib/segment-cache-key';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { getUpstreamRoutes } from '@/lib/upstream-proxy-pool.server';
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockRequireActiveUser(...args),
  isGuardFailure: (result: object) => 'response' in result,
  getOptionalActiveUser: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({
    SiteConfig: { UpstreamProxyPoolSegments: mockSegmentsEnabled },
  }),
}));
jest.mock('@/lib/host-traffic.server', () => ({
  isServerRelayPaused: async () => false,
  serverRelayPausedResponse: jest.fn(),
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: (...args: unknown[]) => mockQuota(...args),
}));
jest.mock('@/app/api/proxy/utils', () => ({
  getProxySourceKey: () => 'sticky-test',
  resolveProxyUserAgent: async () => 'IceTV Test',
}));
jest.mock('@/lib/url-guard', () => ({
  ...jest.requireActual('@/lib/url-guard'),
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
}));
jest.mock('@/lib/upstream-proxy-pool.server', () => ({
  ...jest.requireActual('@/lib/upstream-proxy-pool.server'),
  fetchViaUpstreamRoute: (...args: unknown[]) => mockOrigin(...args),
}));

const mockRequireActiveUser = jest.fn();
const mockQuota = jest.fn<Promise<null>, unknown[]>(async () => null);
const mockOrigin = jest.fn();
let mockSegmentsEnabled = true;
installCryptoPolyfill();
installStreamPolyfills();
Object.assign(globalThis, {
  DOMException: class extends Error {
    constructor(message: string, name: string) {
      super(message);
      this.name = name;
    }
  },
});
const { GET: manifest } =
  require('./m3u8/route') as typeof import('./m3u8/route');
const { GET: key } = require('./key/route') as typeof import('./key/route');
const { GET: segment } =
  require('./segment/route') as typeof import('./segment/route');

function request(url: string): NextRequest {
  return {
    url,
    headers: new Headers({ host: 'localhost', 'x-real-ip': '203.0.113.8' }),
    signal: new AbortController().signal,
  } as NextRequest;
}

function resourceUrl(content: string, path: string): string {
  const match = content.match(
    new RegExp(`http://localhost/api/proxy/${path}\\?[^"\\s]+`),
  );
  if (!match) throw new Error(`Missing ${path} resource`);
  return match[0];
}

describe('signed playback sticky context', () => {
  const originalSecret = process.env.AUTH_SECRET;
  const originalPool = process.env.UPSTREAM_PROXY_POOL;

  beforeEach(() => {
    process.env.AUTH_SECRET = 'sticky-test-secret-with-at-least-32-chars';
    process.env.UPSTREAM_PROXY_POOL =
      'http://proxy-a.example:8000,http://proxy-b.example:8000';
    mockSegmentsEnabled = true;
    mockRequireActiveUser.mockReset().mockResolvedValue({ username: 'viewer' });
    mockQuota.mockClear();
    mockOrigin.mockReset().mockImplementation(async (_route, url: string) => {
      const content = url.includes('master')
        ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8?token=child'
        : url.includes('media')
          ? '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST'
          : new Uint8Array(16);
      const response = new Response(content, {
        headers: {
          'Content-Type': url.includes('m3u8')
            ? 'application/vnd.apple.mpegurl'
            : 'application/octet-stream',
        },
      });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
    if (originalPool === undefined) delete process.env.UPSTREAM_PROXY_POOL;
    else process.env.UPSTREAM_PROXY_POOL = originalPool;
    getUpstreamRoutes();
  });

  it.each([429, 503] as const)(
    'preserves resource error metadata across all proxy routes (%s)',
    async (status) => {
      mockOrigin.mockRejectedValue(new ResourceLimitError(status, 17));
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      for (const [path, handler] of [
        ['m3u8', manifest],
        ['key', key],
        ['segment', segment],
      ] as const) {
        const response = await handler(
          request(
            `http://localhost/api/proxy/${path}?url=${encodeURIComponent(`https://cdn.example/${path}?token=busy-${status}`)}`,
          ),
        );
        expect(response.status).toBe(status);
        expect(response.headers.get('retry-after')).toBe('17');
        expect(response.headers.get('x-icetv-resource-limited')).toBe('1');
        expect(response.headers.get('access-control-expose-headers')).toContain(
          'Retry-After',
        );
      }
    },
  );

  it('propagates key request cancellation to the upstream signal', async () => {
    let upstreamSignal: AbortSignal | undefined;
    mockOrigin.mockImplementation((_route, _url, init) => {
      upstreamSignal = init.signal;
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      );
    });
    const controller = new AbortController();
    const req = request(
      'http://localhost/api/proxy/key?url=https%3A%2F%2Fcdn.example%2Fkey.bin',
    );
    Object.assign(req, { signal: controller.signal });
    const pending = key(req);
    while (!upstreamSignal)
      await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await pending;
    expect(upstreamSignal.aborted).toBe(true);
  });

  it.each([true, false])(
    'keeps the chain sticky and quota identities separate (segments in pool=%s)',
    async (segmentsEnabled) => {
      mockSegmentsEnabled = segmentsEnabled;
      const pool = jest.spyOn(
        require('@/lib/upstream-proxy-pool.server'),
        'getUpstreamRoutes',
      );
      const guard = jest.spyOn(
        require('@/lib/upstream-resource-guard.server'),
        'withUpstreamResponse',
      ) as jest.MockedFunction<typeof withUpstreamResponse>;
      const top = await manifest(
        request(
          'http://localhost/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8%3Ftoken%3Dtop&forceServer=true',
        ),
      );
      expect(top.status).toBe(200);
      const childUrl = resourceUrl(await top.text(), 'm3u8');
      const sticky = new URL(childUrl).searchParams.get('icetv-sticky');
      expect(sticky).toMatch(/^[a-f0-9]{64}$/);
      const child = await manifest(request(childUrl));
      expect(child.status).toBe(200);
      const content = await child.text();
      const keyUrl = resourceUrl(content, 'key');
      const segmentUrl = resourceUrl(content, 'segment');
      for (const url of [keyUrl, segmentUrl])
        expect(new URL(url).searchParams.get('icetv-sticky')).toBe(sticky);
      const keyResponse = await key(request(keyUrl));
      expect(keyResponse.status).toBe(200);
      await keyResponse.arrayBuffer();
      const segmentResponse = await segment(request(segmentUrl));
      expect(segmentResponse.status).toBe(200);
      await segmentResponse.arrayBuffer();
      expect(mockRequireActiveUser).toHaveBeenCalledTimes(1);
      expect(pool.mock.calls).toEqual([
        [sticky, true],
        [sticky, true],
        [sticky, true],
        [sticky, segmentsEnabled],
      ]);
      expect(guard.mock.calls.map((call) => call[2]?.identity)).toEqual([
        'user:viewer',
        'ip:203.0.113.8',
        'ip:203.0.113.8',
        'ip:203.0.113.8',
      ]);
      expect(guard.mock.calls.map((call) => call[2]?.kind)).toEqual([
        undefined,
        undefined,
        undefined,
        'vod',
      ]);
      expect(mockQuota.mock.calls.map((call) => call[2])).toEqual([
        'viewer',
        undefined,
        undefined,
      ]);
      const routes = mockOrigin.mock.calls.map((call) => call[0].id);
      expect(routes.slice(0, 3)).toEqual([routes[0], routes[0], routes[0]]);
      expect(routes[3]).toBe(segmentsEnabled ? routes[0] : 'direct');
    },
  );

  it('reuses normalized and memory keys across signatures while separating sticky contexts', () => {
    const base =
      'http://localhost/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fsegment.ts&icetv-source=demo';
    const first = `${base}&icetv-sticky=${'a'.repeat(64)}&icetv-signature=one&icetv-expires=100`;
    const renewed = first
      .replace('signature=one', 'signature=two')
      .replace('expires=100', 'expires=200');
    const other = renewed.replace('a'.repeat(64), 'b'.repeat(64));
    expect(normalizeSegmentCacheKey(first)).toBe(
      normalizeSegmentCacheKey(renewed),
    );
    expect(normalizeSegmentCacheKey(first)).not.toBe(
      normalizeSegmentCacheKey(other),
    );
    const cache = createFragmentMemoryCache();
    cache.put(first, {
      data: new Uint8Array(16),
      complete: true,
      totalBytes: 16,
      ttfbMs: 1,
      transferMs: 1,
    });
    expect(cache.has(renewed)).toBe(true);
    expect(cache.has(other)).toBe(false);
    expect(cache.getUsage().entries).toBe(1);
  });
});
