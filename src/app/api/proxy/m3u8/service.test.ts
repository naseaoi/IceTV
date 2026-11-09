/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: (...args: unknown[]) => mockAuthorization(...args),
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: async () => null,
}));
jest.mock('@/features/play/lib/m3u8-rewrite', () => ({
  getRewrittenM3U8Content: async (entry: { content: string }) => entry.content,
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({ SiteConfig: {} }),
}));
jest.mock('@/lib/http-proxy-json', () => ({
  fetchResponseThroughProxy: jest.fn(),
  getProxyUrlForTarget: () => undefined,
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetch(...args),
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
  UrlValidationError: class extends Error {},
}));

const mockFetch = jest.fn();
const mockAuthorization = jest.fn();
installStreamPolyfills();
const { loadM3U8Data, peekM3U8Cache, refreshM3U8Cache } =
  require('@/app/api/proxy/m3u8/service') as typeof import('@/app/api/proxy/m3u8/service');
const { GET } =
  require('@/app/api/proxy/m3u8/route') as typeof import('@/app/api/proxy/m3u8/route');

const START = 1_000_000;
const MINUTE = 60 * 1000;
const SOURCE = 'demo';

function mediaPlaylist(segmentUri: string): string {
  return [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:10',
    '#EXTINF:10,',
    segmentUri,
    '#EXT-X-ENDLIST',
  ].join('\n');
}

async function load(url: string, content: string): Promise<void> {
  mockFetch.mockResolvedValueOnce(
    new Response(content, {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    }),
  );
  await loadM3U8Data(url, 'IceTV Test', SOURCE, false, false, {
    startedAt: START,
    proxyMode: 'server-proxy',
    userAction: null,
    userInitiated: false,
  });
}

describe('m3u8 upstream identity', () => {
  beforeEach(() => {
    mockFetch.mockReset().mockImplementation(
      async () =>
        new Response(mediaPlaylist('seg-1.ts'), {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        }),
    );
  });

  it.each([
    ['session', 'user:viewer'],
    ['signature', 'ip:203.0.113.8'],
  ])(
    'passes %s authorization identity without changing the resource kind',
    async (via, identity) => {
      mockAuthorization.mockResolvedValue({
        authorized: true,
        via,
        username: 'viewer',
      });
      const url = `https://cdn.example/identity/${via}.m3u8?token=test`;
      const response = await GET({
        url: `http://localhost/api/proxy/m3u8?url=${encodeURIComponent(url)}`,
        headers: new Headers({ 'x-real-ip': '203.0.113.8' }),
      } as NextRequest);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          resourceContext: { identity },
          useProxyPool: true,
        }),
      );
    },
  );

  it('preserves the requesting identity during a background refresh', async () => {
    const url = 'https://cdn.example/identity/refresh.m3u8';
    await refreshM3U8Cache(url, 'IceTV Test', SOURCE, false, 'user:viewer');
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        resourceContext: { identity: 'user:viewer' },
      }),
    );
  });

  it('keeps live fallback outside the upstream pool', async () => {
    const url = 'https://cdn.example/identity/live.m3u8';
    await loadM3U8Data(url, 'IceTV Test', SOURCE, true, true, {
      identity: 'user:viewer',
      startedAt: Date.now(),
      proxyMode: 'server-proxy',
      userAction: null,
      userInitiated: false,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        resourceContext: { identity: 'user:viewer' },
        useProxyPool: false,
      }),
    );
  });
});

describe('m3u8 cache ttl', () => {
  let clock: jest.SpyInstance<number, []>;

  beforeEach(() => {
    mockFetch.mockReset();
    clock = jest.spyOn(Date, 'now').mockReturnValue(START);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('缓存 rycj 原始广告和边界，并保持源隔离', async () => {
    const url = 'https://cdn.example/vod/rycj/index.m3u8';
    const content = [
      '#EXTM3U',
      ...Array.from({ length: 8 }, (_, block) => [
        '#EXT-X-DISCONTINUITY',
        ...Array.from(
          { length: 5 },
          (_, fragment) =>
            `#EXTINF:${block === 3 ? 4 : 5},\n${block}-${fragment}.ts`,
        ),
      ]).flat(),
      '#EXT-X-ENDLIST',
    ].join('\n');
    mockFetch.mockResolvedValueOnce(new Response(content));
    const result = await loadM3U8Data(url, 'test', 'rycj', false, false, {
      startedAt: START,
      proxyMode: 'server-proxy',
      userAction: null,
      userInitiated: false,
    });
    expect(result.content).toBe(content);
    expect(peekM3U8Cache(url, 'rycj')?.value.content).toBe(content);
    expect(peekM3U8Cache(url, 'other')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps ended media playlists without signed params for thirty minutes', async () => {
    const url = 'https://cdn.example/vod/ended/index.m3u8';
    await load(url, mediaPlaylist('seg-1.ts'));

    clock.mockReturnValue(START + 19 * MINUTE);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: true });
    clock.mockReturnValue(START + 25 * MINUTE);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: false });
    clock.mockReturnValue(START + 30 * MINUTE + 1);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
  });

  it.each([
    [
      'signed segment urls',
      'https://cdn.example/vod/signed/index.m3u8',
      mediaPlaylist('seg-1.ts?token=abc&expires=1700000000'),
    ],
    [
      'master playlists',
      'https://cdn.example/vod/master/index.m3u8',
      ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=800000', 'low/index.m3u8'].join(
        '\n',
      ),
    ],
  ])('keeps the one minute ttl for %s', async (_label, url, content) => {
    await load(url, content);

    clock.mockReturnValue(START + 59_000);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: true });
    clock.mockReturnValue(START + 90_000);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: false });
    clock.mockReturnValue(START + 120_000);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
  });
});
