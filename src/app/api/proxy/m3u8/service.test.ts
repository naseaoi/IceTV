/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: (...args: unknown[]) => mockAuthorization(...args),
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: (...args: unknown[]) => mockQuota(...args),
}));
jest.mock('@/features/play/lib/m3u8-rewrite', () => ({
  getRewrittenM3U8Content: (...args: unknown[]) => mockRewrite(...args),
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => mockConfig,
}));
jest.mock('@/lib/http-proxy-json', () => ({
  fetchResponseThroughProxy: jest.fn(),
  getProxyUrlForTarget: () => undefined,
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetch(...args),
  validateProxyUrlForRequest: (...args: unknown[]) => mockValidate(...args),
  UrlValidationError: class extends Error {},
}));

const mockFetch = jest.fn();
const mockConfig = { SiteConfig: { EnableLiveEntry: true } };
const mockQuota = jest.fn(
  async (..._args: unknown[]) => null as Response | null,
);
const mockValidate = jest.fn(async (...args: unknown[]) => ({
  ok: true,
  url: args[0] as string,
}));
const mockRewrite = jest.fn(
  async (...args: unknown[]) => (args[0] as { content: string }).content,
);
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
  it('shares raw results and in-flight loads across sticky contexts', async () => {
    const url = 'https://cdn.example/sticky-shared/master.m3u8';
    let finish!: (value: Response) => void;
    mockFetch.mockReset().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const context = {
      startedAt: Date.now(),
      proxyMode: 'server-proxy',
      userAction: null,
      userInitiated: false,
    };
    const first = loadM3U8Data(url, 'IceTV Test', SOURCE, false, false, {
      ...context,
      proxyPoolStickyKey: 'a'.repeat(64),
    });
    const second = loadM3U8Data(url, 'IceTV Test', SOURCE, false, false, {
      ...context,
      proxyPoolStickyKey: 'b'.repeat(64),
    });
    expect(second).toBe(first);
    while (!finish)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    finish(
      new Response(mediaPlaylist('seg-1.ts'), {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      }),
    );
    await Promise.all([first, second]);
    await loadM3U8Data(url, 'IceTV Test', SOURCE, false, false, {
      ...context,
      proxyPoolStickyKey: 'c'.repeat(64),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

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
    await refreshM3U8Cache(
      url,
      'IceTV Test',
      SOURCE,
      false,
      'user:viewer',
      'a'.repeat(64),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        resourceContext: { identity: 'user:viewer' },
        proxyPoolStickyKey: 'a'.repeat(64),
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

describe('warm-only m3u8', () => {
  const request = (url: string, warm = true, live = false) =>
    ({
      url: `http://localhost/api/proxy/m3u8?url=${encodeURIComponent(url)}&source=${SOURCE}${live ? '&icetv-live=1' : ''}`,
      headers: new Headers(warm ? { 'X-IceTV-Warm-Only': '1' } : {}),
    }) as NextRequest;
  const upstream = (content = mediaPlaylist('seg.ts'), finalUrl = '') => {
    const response = new Response(content);
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  };

  beforeEach(() => {
    mockAuthorization.mockResolvedValue({
      authorized: true,
      via: 'session',
      username: 'viewer',
    });
    mockFetch.mockReset().mockImplementation(async () => upstream());
    mockRewrite.mockClear();
    mockQuota.mockClear();
    mockValidate.mockClear();
  });

  it('warms raw cache without rewriting or returning a body, then serves playback from it', async () => {
    const url = 'https://cdn.example/warm/early.m3u8';
    for (let index = 0; index < 2; index++) {
      const response = await GET(request(url));
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(mockRewrite).not.toHaveBeenCalled();
    expect(peekM3U8Cache(url, SOURCE)).not.toBeNull();
    expect(await (await GET(request(url, false))).text()).toContain('#EXTM3U');
    expect(mockRewrite).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'shares overlapping warm and playback loads (warm first: %s)',
    async (warmFirst) => {
      const url = `https://cdn.example/warm/concurrent-${warmFirst}.m3u8`;
      let finish!: (response: Response) => void;
      mockFetch.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      const first = GET(request(url, warmFirst));
      while (!finish)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const second = GET(request(url, !warmFirst));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      finish(upstream());
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status)).toEqual(
        warmFirst ? [204, 200] : [200, 204],
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockRewrite).toHaveBeenCalledTimes(1);
    },
  );

  it('skips known signed URLs after authorization, quota and URL validation', async () => {
    const url = 'https://cdn.example/warm/signed.m3u8?token=short';
    expect((await GET(request(url))).status).toBe(204);
    expect(mockAuthorization).toHaveBeenCalled();
    expect(mockQuota).toHaveBeenCalledTimes(1);
    expect(mockValidate).toHaveBeenCalledWith(url);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRewrite).not.toHaveBeenCalled();
  });

  it('keeps auth, quota and URL rejection effective for warm requests', async () => {
    const url = 'https://cdn.example/warm/rejected.m3u8?token=short';
    mockAuthorization.mockResolvedValueOnce({
      authorized: false,
      response: new Response(null, { status: 401 }),
    });
    expect((await GET(request(url))).status).toBe(401);
    mockQuota.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(request(url))).status).toBe(429);
    mockValidate.mockResolvedValueOnce({ ok: false, url });
    expect((await GET(request(url))).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRewrite).not.toHaveBeenCalled();
  });

  it.each(['redirect-signed', 'ongoing'])(
    'does not cache a response found uncacheable after loading: %s',
    async (kind) => {
      const url = `https://cdn.example/warm/${kind}.m3u8`;
      mockFetch.mockImplementation(async () =>
        kind === 'redirect-signed'
          ? upstream(mediaPlaylist('seg.ts'), `${url}?token=short`)
          : upstream('#EXTM3U\n#EXTINF:6,\nseg.ts', url),
      );
      expect((await GET(request(url))).status).toBe(204);
      expect(peekM3U8Cache(url, SOURCE)).toBeNull();
      expect(mockRewrite).not.toHaveBeenCalled();
      expect((await GET(request(url, false))).status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    },
  );

  it('does not cache failed warm loads and permits retries', async () => {
    const url = 'https://cdn.example/warm/retry.m3u8';
    mockFetch.mockRejectedValueOnce(new Error('synthetic failure'));
    expect((await GET(request(url))).status).toBe(500);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
    expect((await GET(request(url))).status).toBe(204);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRewrite).not.toHaveBeenCalled();
  });

  it('ignores the warm marker for live playback', async () => {
    const url = 'https://cdn.example/warm/live.m3u8';
    const response = await GET(request(url, true, true));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('#EXTM3U');
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
    expect(mockRewrite).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
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
