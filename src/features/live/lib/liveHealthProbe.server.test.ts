/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { isServerRelayPaused } from '@/lib/host-traffic.server';
import {
  fetchStreamThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import {
  ResourceLimitError,
  UpstreamCooldownError,
} from '@/lib/server-resource-errors';
import { fetchWithUrlGuard, validateProxyUrlForRequest } from '@/lib/url-guard';

import { LIVE_HEALTH_POLICY as POLICY } from './liveHealthPolicy';
import {
  createLiveHealthBudget,
  createLiveHealthHostGate,
  probeLiveLine,
} from './liveHealthProbe.server';

jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
  validateProxyUrlForRequest: jest.fn(),
  UrlValidationError: class extends Error {},
}));
jest.mock('@/lib/host-traffic.server', () => ({
  isServerRelayPaused: jest.fn(),
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: jest.fn(),
  fetchStreamThroughProxy: jest.fn(),
}));
installStreamPolyfills();
const fetchMock = jest.mocked(fetchWithUrlGuard);
const media =
  '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nold.ts\n#EXTINF:6,\nnew.ts';
const context = (bytes?: number) => ({
  budget: createLiveHealthBudget(bytes),
  withHost: createLiveHealthHostGate(),
  signal: new AbortController().signal,
});
const probe = (ctx = context()) =>
  probeLiveLine('https://live.example/index.m3u8', 'test-ua', ctx);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isServerRelayPaused).mockResolvedValue(false);
});
afterEach(() => jest.useRealTimers());

it('samples the latest segment with live quota, UA and pool bypass', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(media))
    .mockResolvedValueOnce(new Response('sample'));
  expect(await probe()).toMatchObject({
    status: 'ok',
    latencyMs: expect.any(Number),
  });
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    'https://live.example/index.m3u8',
    expect.objectContaining({
      useProxyPool: false,
      resourceContext: { identity: 'system:live-health' },
      headers: expect.objectContaining({ 'User-Agent': 'test-ua' }),
    }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    'https://live.example/new.ts',
    expect.objectContaining({
      resourceContext: { identity: 'system:live-health', kind: 'live' },
      headers: expect.objectContaining({ Range: 'bytes=0-65535' }),
    }),
  );
});

it.each([
  [403, 'forbidden'],
  [404, 'not_found'],
  [410, 'not_found'],
  [500, 'http_error'],
])('classifies HTTP %s and cancels its body', async (status, reason) => {
  const cancel = jest.fn();
  fetchMock.mockResolvedValue(
    new Response(new ReadableStream({ cancel }), { status: Number(status) }),
  );
  expect(await probe()).toMatchObject({ status: 'failed', reason });
  expect(cancel).toHaveBeenCalled();
});

it.each([
  ['bad body', 'invalid_playlist'],
  ['#EXTM3U\n', 'invalid_playlist'],
])('validates playlist %s', async (body, reason) => {
  fetchMock.mockResolvedValueOnce(new Response(body));
  expect(await probe()).toMatchObject({ status: 'failed', reason });
});

it('marks ENDLIST as ended without requesting media', async () => {
  fetchMock.mockResolvedValueOnce(new Response(`${media}\n#EXT-X-ENDLIST`));
  expect(await probe()).toMatchObject({ status: 'ended' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'keeps an oversized media prefix and marks ended (variant=%s)',
  async (variant) => {
    const cancel = jest.fn();
    const prefix = new TextEncoder().encode('#EXTM3U\n#EXTINF:6,\nold.ts\n');
    if (variant)
      fetchMock.mockResolvedValueOnce(
        new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8'),
      );
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(prefix);
            controller.enqueue(new Uint8Array(POLICY.playlistMaxBytes));
          },
          cancel,
        }),
      ),
    );
    expect(await probe()).toMatchObject({ status: 'ended' });
    expect(fetchMock).toHaveBeenCalledTimes(variant ? 2 : 1);
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

it.each([
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8\n',
  'not-m3u8\n#EXTINF:6,\nold.ts\n',
])(
  'rejects an oversized body without a media playlist prefix',
  async (prefix) => {
    fetchMock.mockResolvedValueOnce(
      new Response(prefix + 'x'.repeat(POLICY.playlistMaxBytes)),
    );
    expect(await probe()).toMatchObject({
      status: 'failed',
      reason: 'invalid_playlist',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ['older', 1, 'ended'],
  ['boundary', 0, 'ok'],
  ['recent', -1, 'ok'],
] as const)(
  'checks the latest segment program timestamp at the 24-hour boundary (%s)',
  async (_, extraAge, status) => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const date = new Date(
      now - POLICY.endedProgramAgeMs - extraAge,
    ).toISOString();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          `#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:${date}\n#EXTINF:6,\nlatest.ts`,
        ),
      )
      .mockResolvedValueOnce(new Response('sample'));
    try {
      expect(await probe()).toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(status === 'ended' ? 1 : 2);
    } finally {
      clock.mockRestore();
    }
  },
);

it('advances the first program timestamp by segment durations and uses a later explicit timestamp', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const old = new Date(now - POLICY.endedProgramAgeMs - 3000).toISOString();
  const recent = new Date(now).toISOString();
  try {
    for (const prefix of [
      `#EXT-X-PROGRAM-DATE-TIME:${old}\n#EXTINF:6,\nold.ts\n`,
      `#EXT-X-PROGRAM-DATE-TIME:${old}\n#EXTINF:1,\nold.ts\n#EXT-X-PROGRAM-DATE-TIME:${recent}\n`,
      '#EXT-X-PROGRAM-DATE-TIME:invalid\n',
      `#EXT-X-PROGRAM-DATE-TIME:${old}\n#EXTINF:1,\nold.ts\n#EXT-X-DISCONTINUITY\n`,
    ]) {
      fetchMock
        .mockResolvedValueOnce(
          new Response(`#EXTM3U\n${prefix}#EXTINF:6,\nlatest.ts`),
        )
        .mockResolvedValueOnce(new Response('sample'));
      expect(await probe()).toMatchObject({ status: 'ok' });
    }
  } finally {
    clock.mockRestore();
  }
});

it('follows one variant and resolves URLs against the final redirected playlist', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: '/dir/master.m3u8' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild/index.m3u8',
      ),
    )
    .mockResolvedValueOnce(new Response(media))
    .mockResolvedValueOnce(new Response('sample'));
  expect(await probe()).toMatchObject({ status: 'ok' });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://live.example/index.m3u8',
    'https://live.example/dir/master.m3u8',
    'https://live.example/dir/child/index.m3u8',
    'https://live.example/dir/child/new.ts',
  ]);
});

it('rejects a second master level', async () => {
  fetchMock.mockResolvedValue(
    new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8'),
  );
  // 每次读取需独立的 Response。
  fetchMock.mockImplementation(
    async () =>
      new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8'),
  );
  expect(await probe()).toMatchObject({ reason: 'invalid_playlist' });
});

it('classifies segment errors separately', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(media))
    .mockResolvedValueOnce(new Response('denied', { status: 403 }));
  expect(await probe()).toMatchObject({
    status: 'failed',
    reason: 'segment_failed',
  });
});

it.each([new ResourceLimitError(), new UpstreamCooldownError(30)])(
  'defers resource and upstream cooldown errors',
  async (error) => {
    fetchMock.mockRejectedValueOnce(error);
    expect(await probe()).toBeNull();
  },
);

it('uses the validated environment proxy with the same resource identity', async () => {
  jest
    .mocked(getProxyUrlForTarget)
    .mockReturnValue(new URL('http://proxy.example:8080'));
  jest
    .mocked(validateProxyUrlForRequest)
    .mockImplementation(async (url) => ({ ok: true, url }));
  jest
    .mocked(fetchStreamThroughProxy)
    .mockImplementation(async (_, __, options) => ({
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: new Response(
        options.resourceContext?.kind === 'live' ? 'sample' : media,
      ).body!,
    }));
  expect(await probe()).toMatchObject({ status: 'ok' });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(validateProxyUrlForRequest).toHaveBeenCalledTimes(2);
  expect(fetchStreamThroughProxy).toHaveBeenLastCalledWith(
    expect.any(URL),
    expect.any(URL),
    expect.objectContaining({
      resourceContext: { identity: 'system:live-health', kind: 'live' },
    }),
  );
});

it('defers resource limits encountered while reading the segment', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(media))
    .mockRejectedValueOnce(new ResourceLimitError());
  expect(await probe()).toBeNull();
});

it('defers relay pause without any request', async () => {
  jest.mocked(isServerRelayPaused).mockResolvedValue(true);
  expect(await probe()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('classifies network and timeout errors', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
  expect(await probe()).toMatchObject({ reason: 'unreachable' });
  fetchMock.mockRejectedValueOnce(
    Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
  );
  expect(await probe()).toMatchObject({ reason: 'timeout' });
});

it('includes first body byte delay in slow classification', async () => {
  let now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  fetchMock
    .mockImplementationOnce(async () => {
      now += POLICY.slowMs + 1;
      return new Response(media);
    })
    .mockResolvedValueOnce(new Response('sample'));
  try {
    expect(await probe()).toMatchObject({ status: 'slow' });
  } finally {
    clock.mockRestore();
  }
});

it('keeps the request deadline active while reading a stalled body', async () => {
  const originalSetTimeout = global.setTimeout;
  const timer = jest
    .spyOn(global, 'setTimeout')
    .mockImplementation(((callback: () => void, delay: number) =>
      originalSetTimeout(
        callback,
        delay === POLICY.requestTimeoutMs ? 10 : delay,
      )) as typeof setTimeout);
  fetchMock.mockImplementationOnce(
    async (_, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(init.signal?.reason),
              { once: true },
            );
          },
        }),
      ),
  );
  try {
    expect(await probe()).toMatchObject({
      status: 'failed',
      reason: 'timeout',
    });
  } finally {
    timer.mockRestore();
  }
});

it('cancels after 64KiB even when the server ignores Range', async () => {
  const cancel = jest.fn();
  fetchMock.mockResolvedValueOnce(new Response(media)).mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(POLICY.segmentSampleBytes));
        },
        cancel,
      }),
    ),
  );
  expect(await probe()).toMatchObject({ status: 'ok' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('cancels oversized playlists and stops at the round reservation budget', async () => {
  const cancel = jest.fn();
  fetchMock.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(POLICY.playlistMaxBytes + 1));
        },
        cancel,
      }),
    ),
  );
  expect(await probe()).toMatchObject({ reason: 'invalid_playlist' });
  expect(cancel).toHaveBeenCalled();
  fetchMock.mockClear();
  fetchMock.mockResolvedValueOnce(new Response(media));
  expect(await probe(context(POLICY.playlistMaxBytes))).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('short-circuits queued lines after two connection failures without charging their budget', async () => {
  const ctx = context();
  fetchMock
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockRejectedValueOnce(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    );
  const results = await Promise.all([
    probe(ctx),
    probeLiveLine('https://LIVE.example:8443/other.m3u8', 'ua', ctx),
    probeLiveLine('https://live.example./third.m3u8', 'ua', ctx),
  ]);
  expect(results).toEqual([
    expect.objectContaining({ status: 'failed', reason: 'unreachable' }),
    expect.objectContaining({ status: 'failed', reason: 'timeout' }),
    expect.objectContaining({
      status: 'failed',
      reason: 'timeout',
      checkedAt: expect.any(Number),
    }),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(POLICY.hostConnectionFailureLimit);
  expect(ctx.budget.reservedBytes).toBe(
    POLICY.hostConnectionFailureLimit * POLICY.playlistMaxBytes,
  );
  fetchMock.mockResolvedValueOnce(new Response(`${media}\n#EXT-X-ENDLIST`));
  expect(await probe()).toMatchObject({ status: 'ended' });
});

it.each([
  [403, 'forbidden'],
  [404, 'not_found'],
  [200, 'ended'],
] as const)(
  'resets connection failures on an HTTP %s response',
  async (status, middleReason) => {
    const ctx = context();
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(`${media}\n#EXT-X-ENDLIST`, { status }),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    await probe(ctx);
    expect(await probe(ctx)).toMatchObject(
      middleReason === 'ended' ? { status: 'ended' } : { reason: middleReason },
    );
    await probe(ctx);
    await probe(ctx);
    await probe(ctx);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  },
);

it('counts segment connection failures against the actual CDN hostname', async () => {
  const ctx = context();
  const urls: string[] = [];
  fetchMock.mockImplementation(async (url) => {
    urls.push(url);
    if (new URL(url).hostname === 'cdn.example')
      throw new TypeError('fetch failed');
    return new Response('#EXTM3U\n#EXTINF:6,\nhttps://cdn.example/latest.ts');
  });
  expect(await probe(ctx)).toMatchObject({ reason: 'segment_failed' });
  expect(await probe(ctx)).toMatchObject({ reason: 'segment_failed' });
  expect(await probe(ctx)).toMatchObject({ reason: 'unreachable' });
  expect(
    urls.filter((url) => new URL(url).hostname === 'cdn.example'),
  ).toHaveLength(2);
  expect(
    urls.filter((url) => new URL(url).hostname === 'live.example'),
  ).toHaveLength(3);
  const reserved = ctx.budget.reservedBytes;
  expect(
    await probeLiveLine('https://cdn.example/another.m3u8', 'ua', ctx),
  ).toMatchObject({ reason: 'unreachable' });
  expect(ctx.budget.reservedBytes).toBe(reserved);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it('counts redirected connection failures against the redirect target', async () => {
  const ctx = context();
  fetchMock.mockImplementation(async (url) => {
    if (new URL(url).hostname === 'target.example')
      throw new TypeError('fetch failed');
    return new Response(null, {
      status: 302,
      headers: { location: 'https://target.example/media.m3u8' },
    });
  });
  await probe(ctx);
  await probe(ctx);
  expect(await probe(ctx)).toMatchObject({ reason: 'unreachable' });
  expect(
    fetchMock.mock.calls.filter(
      ([url]) => new URL(url).hostname === 'target.example',
    ),
  ).toHaveLength(2);
});

it('resets the connection streak when a received HTTP response starts upstream cooldown', async () => {
  const ctx = context();
  fetchMock
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockRejectedValueOnce(new UpstreamCooldownError(30, true))
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(new Response(`${media}\n#EXT-X-ENDLIST`));
  await probe(ctx);
  expect(await probe(ctx)).toBeNull();
  await probe(ctx);
  expect(await probe(ctx)).toMatchObject({ status: 'ended' });
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('keeps resource deferrals out of the connection failure threshold', async () => {
  const ctx = context();
  fetchMock
    .mockRejectedValueOnce(new ResourceLimitError())
    .mockRejectedValueOnce(new UpstreamCooldownError(30))
    .mockResolvedValueOnce(new Response(`${media}\n#EXT-X-ENDLIST`));
  expect(await probe(ctx)).toBeNull();
  expect(await probe(ctx)).toBeNull();
  expect(await probe(ctx)).toMatchObject({ status: 'ended' });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('serializes a shared hostname across ports while allowing another host', async () => {
  const gate = createLiveHealthHostGate();
  const events: string[] = [];
  let release!: () => void;
  const first = gate('https://live.example/a', async () => {
    events.push('a');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const second = gate('https://live.example:8443/b', async () => {
    events.push('b');
  });
  await gate('https://other.example/c', async () => {
    events.push('c');
  });
  expect(events).toEqual(['a', 'c']);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(['a', 'c', 'b']);
});
