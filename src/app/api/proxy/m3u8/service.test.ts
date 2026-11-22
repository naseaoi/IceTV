/** @jest-environment node */

import type { NextRequest } from 'next/server';
import { gzipSync } from 'node:zlib';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import {
  fetchResponseThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';

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
  getProxyUrlForTarget: jest.fn(),
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
Object.assign(globalThis, {
  DOMException: class extends Error {
    constructor(message: string, name: string) {
      super(message);
      this.name = name;
    }
  },
});
const { loadM3U8Data, peekM3U8Cache, refreshM3U8Cache } =
  require('@/app/api/proxy/m3u8/service') as typeof import('@/app/api/proxy/m3u8/service');
const { GET } =
  require('@/app/api/proxy/m3u8/route') as typeof import('@/app/api/proxy/m3u8/route');

const START = 1_000_000;
const MINUTE = 60 * 1000;
const SOURCE = 'demo';

const { GET: key } =
  require('@/app/api/proxy/key/route') as typeof import('@/app/api/proxy/key/route');

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
  it.each([false, true])(
    'cancels shared upstream only after all consumers leave (skipCache=%s)',
    async (skipCache) => {
      const signals: AbortSignal[] = [];
      mockFetch.mockReset().mockImplementation((_url, init) => {
        signals.push(init.signal);
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      });
      const first = new AbortController();
      const second = new AbortController();
      const url = `https://cdn.example/cancel/${skipCache}.m3u8`;
      const context = {
        startedAt: Date.now(),
        proxyMode: 'server-proxy',
        userAction: null,
        userInitiated: false,
      };
      const a = loadM3U8Data(url, 'test', SOURCE, false, skipCache, {
        ...context,
        signal: first.signal,
      });
      const b = loadM3U8Data(url, 'test', SOURCE, false, skipCache, {
        ...context,
        signal: second.signal,
      });
      const rejectedA = expect(a).rejects.toMatchObject({ name: 'AbortError' });
      const rejectedB = expect(b).rejects.toMatchObject({ name: 'AbortError' });
      while (!signals.length)
        await new Promise((resolve) => setTimeout(resolve, 0));
      first.abort();
      await rejectedA;
      expect(signals[0].aborted).toBe(false);
      second.abort();
      await rejectedB;
      await Promise.resolve();
      expect(signals[0].aborted).toBe(true);
      mockFetch.mockResolvedValue(new Response(mediaPlaylist('fresh.ts')));
      const retry = await loadM3U8Data(
        url,
        'test',
        SOURCE,
        false,
        skipCache,
        context,
      );
      expect(retry.content).toContain('fresh.ts');
    },
  );

  it('shares raw results and in-flight loads across sticky contexts without a proxy pool', async () => {
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
    expect(second).not.toBe(first);
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

  it('partitions raw cache, warm and in-flight loads by routing context when the proxy pool is on', async () => {
    const previousPool = process.env.UPSTREAM_PROXY_POOL;
    process.env.UPSTREAM_PROXY_POOL =
      'https://egress-a.example https://egress-b.example';
    const url = 'https://cdn.example/sticky-pool/master.m3u8';
    const stickyA = 'a'.repeat(64);
    const stickyB = 'b'.repeat(64);
    const request = (warm: boolean) =>
      ({
        url: `http://localhost/api/proxy/m3u8?url=${encodeURIComponent(url)}&source=${SOURCE}`,
        headers: new Headers(warm ? { 'X-IceTV-Warm-Only': '1' } : {}),
      }) as NextRequest;
    const authorize = (proxyPoolStickyKey: string) =>
      mockAuthorization.mockResolvedValueOnce({
        authorized: true,
        via: 'session',
        username: 'viewer',
        proxyPoolStickyKey,
      });
    const context = {
      startedAt: Date.now(),
      proxyMode: 'server-proxy',
      userAction: null,
      userInitiated: false,
    };
    try {
      mockFetch.mockImplementation(
        async (
          target: string,
          init: { proxyPoolStickyKey?: string; resourceContext?: unknown },
        ) => {
          const tag = init.proxyPoolStickyKey?.[0] ?? 'legacy';
          return new Response(
            mediaPlaylist(
              target.includes('embedded') ? `${tag}.ts?token=x` : `${tag}.ts`,
            ),
          );
        },
      );
      // 同一 sticky 的预热由正式播放复用，其他 sticky 单独回源
      authorize(stickyA);
      expect((await GET(request(true))).status).toBe(204);
      authorize(stickyB);
      expect(await (await GET(request(false))).text()).toContain('b.ts');
      authorize(stickyA);
      expect(await (await GET(request(false))).text()).toContain('a.ts');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(peekM3U8Cache(url, SOURCE)).toBeNull();
      expect(
        peekM3U8Cache(url, SOURCE, { proxyPoolStickyKey: stickyA }),
      ).not.toBeNull();

      // 入口无签名、正文才带签名时，并发加载在拿到正文前已按 sticky 分开
      const embeddedUrl = url.replace('master', 'embedded');
      const [first, second, third] = await Promise.all(
        [stickyA, stickyB, stickyA].map((proxyPoolStickyKey) =>
          loadM3U8Data(embeddedUrl, 'test', SOURCE, false, false, {
            ...context,
            proxyPoolStickyKey,
          }),
        ),
      );
      expect(first.content).toContain('a.ts');
      expect(second.content).toContain('b.ts');
      expect(third.content).toContain('a.ts');
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // 缺少 sticky 的旧签名按计额身份分区
      const legacyUrl = url.replace('master', 'legacy');
      await loadM3U8Data(legacyUrl, 'test', SOURCE, false, false, {
        ...context,
        identity: 'ip:198.51.100.1',
      });
      await loadM3U8Data(legacyUrl, 'test', SOURCE, false, false, {
        ...context,
        identity: 'ip:198.51.100.2',
      });
      await loadM3U8Data(legacyUrl, 'test', SOURCE, false, false, {
        ...context,
        identity: 'ip:198.51.100.1',
      });
      expect(mockFetch).toHaveBeenCalledTimes(6);
    } finally {
      if (previousPool === undefined) delete process.env.UPSTREAM_PROXY_POOL;
      else process.env.UPSTREAM_PROXY_POOL = previousPool;
    }
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

  it.each([
    ['m3u8', GET],
    ['key', key],
  ] as const)(
    'does not expose raw compressed live %s bytes as decoded output',
    async (path, handler) => {
      const isManifest = path === 'm3u8';
      const body = isManifest ? mediaPlaylist('seg-1.ts') : '0123456789abcdef';
      const contentType = isManifest
        ? 'application/vnd.apple.mpegurl'
        : 'application/octet-stream';
      mockAuthorization.mockResolvedValue({
        authorized: true,
        via: 'session',
        username: 'viewer',
      });
      const warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest
        .mocked(getProxyUrlForTarget)
        .mockReturnValueOnce(new URL('http://proxy.example'));
      jest.mocked(fetchResponseThroughProxy).mockResolvedValueOnce({
        body: gzipSync(body),
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': contentType,
          'content-encoding': 'gzip',
        }),
      });
      mockFetch.mockResolvedValueOnce(
        new Response(body, {
          headers: {
            'content-type': contentType,
            'content-encoding': 'gzip',
            'content-length': '10',
          },
        }),
      );
      const url =
        'http://localhost/api/proxy/' +
        path +
        '?icetv-live=1&url=' +
        encodeURIComponent('https://cdn.example/live.' + path);
      try {
        const response = await handler({
          url,
          headers: new Headers(),
        } as NextRequest);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(body);
        expect(response.headers.has('content-encoding')).toBe(false);
        expect(response.headers.get('content-length')).not.toBe('10');
        expect(fetchResponseThroughProxy).toHaveBeenLastCalledWith(
          expect.any(URL),
          expect.any(URL),
          expect.objectContaining({
            headers: { 'Accept-Encoding': 'identity' },
          }),
        );
      } finally {
        warnings.mockRestore();
      }
    },
  );

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

  it('keeps distinct upstream signature values separate and uncached', async () => {
    const url = 'https://cdn.example/vod/distinct-tokens.m3u8';
    const signed = (token: string) => `${url}?token=${token}`;
    mockFetch.mockImplementation(async (target: string) =>
      upstream(
        mediaPlaylist(`${new URL(target).searchParams.get('token')}.ts`),
      ),
    );
    const results = await Promise.all(
      ['first', 'second'].map(async (token) =>
        (await GET(request(signed(token), false))).text(),
      ),
    );
    expect(results).toEqual([
      mediaPlaylist('first.ts'),
      mediaPlaylist('second.ts'),
    ]);
    expect((await GET(request(signed('first'), false))).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each(['redirect-signed', 'embedded-signed', 'ongoing'])(
    'does not cache a response found uncacheable after loading: %s',
    async (kind) => {
      const url = `https://cdn.example/warm/${kind}.m3u8`;
      mockFetch.mockImplementation(async () => {
        if (kind === 'redirect-signed')
          return upstream(mediaPlaylist('seg.ts'), `${url}?token=short`);
        if (kind === 'embedded-signed')
          return upstream(mediaPlaylist('seg.ts?token=short'), url);
        return upstream('#EXTM3U\n#EXTINF:6,\nseg.ts', url);
      });
      expect((await GET(request(url))).status).toBe(204);
      expect(peekM3U8Cache(url, SOURCE)).toBeNull();
      expect(mockRewrite).not.toHaveBeenCalled();
      expect((await GET(request(url, false))).status).toBe(200);
      expect(mockRewrite.mock.lastCall?.[7]).toBe(false);
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
    ['segment', mediaPlaylist('seg-1.ts?token=abc&expires=1001')],
    [
      'key',
      mediaPlaylist('#EXT-X-KEY:METHOD=AES-128,URI="key?token=abc"\nseg.ts'),
    ],
    [
      'child playlist',
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8?token=abc',
    ],
  ])('does not cache a playlist with a signed %s', async (label, content) => {
    const url = `https://cdn.example/vod/signed-${label}/index.m3u8`;
    await load(url, content);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
  });

  it('keeps the one minute fresh ttl for unsigned master playlists', async () => {
    const url = 'https://cdn.example/vod/master/index.m3u8';
    await load(url, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8');

    clock.mockReturnValue(START + 59_000);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: true });
    clock.mockReturnValue(START + 90_000);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: false });
    clock.mockReturnValue(START + 120_000);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
  });
});
