/** @jest-environment node */

import {
  clearUrlGuardDnsCacheForTests,
  fetchWithUrlGuard,
  getUrlGuardDnsCacheSizeForTests,
  resetUrlGuardDnsLookupForTests,
  setUrlGuardDnsLookupForTests,
  validateProxyUrl,
  validateProxyUrlForRequest,
} from '../url-guard';

jest.mock('@/lib/upstream-proxy-pool.server', () => ({
  ...jest.requireActual('@/lib/upstream-proxy-pool.server'),
}));

const upstreamPool = jest.requireMock<
  typeof import('../upstream-proxy-pool.server')
>('@/lib/upstream-proxy-pool.server');

describe('upstream route failover', () => {
  const originalPool = process.env.UPSTREAM_PROXY_POOL;
  const proxy = 'http://proxy.example:8080';
  const url = 'https://example.com/resource';
  const response = { status: 200, body: null } as Response;

  beforeEach(() => {
    delete process.env.UPSTREAM_PROXY_POOL;
    upstreamPool.getUpstreamRoutes('example.com');
    process.env.UPSTREAM_PROXY_POOL = `direct,${proxy}`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalPool === undefined) delete process.env.UPSTREAM_PROXY_POOL;
    else process.env.UPSTREAM_PROXY_POOL = originalPool;
    upstreamPool.getUpstreamRoutes('example.com');
  });

  it.each([
    'UND_ERR_CONNECT_TIMEOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
  ])(
    'advances from direct to proxy on a pre-response network failure (%s)',
    async (code) => {
      const error = Object.assign(new TypeError('fetch failed'), {
        cause: { code },
      });
      const fetchRoute = jest
        .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
        .mockRejectedValueOnce(error)
        .mockResolvedValue(response);
      const failed = jest.spyOn(upstreamPool, 'reportUpstreamRouteFailure');
      await expect(
        fetchWithUrlGuard(url, { skipInitialValidation: true }),
      ).resolves.toBe(response);
      expect(fetchRoute.mock.calls.map(([route]) => route.id)).toEqual([
        'direct',
        proxy,
      ]);
      expect(failed).toHaveBeenCalledWith({ id: 'direct' }, 'example.com');
    },
  );

  it('returns HTTP 403 from direct without switching exits', async () => {
    const forbidden = { status: 403, body: null } as Response;
    const fetchRoute = jest
      .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
      .mockResolvedValue(forbidden);
    const failed = jest.spyOn(upstreamPool, 'reportUpstreamRouteFailure');
    await expect(
      fetchWithUrlGuard(url, { skipInitialValidation: true }),
    ).resolves.toBe(forbidden);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('keeps body read failures on the delivered response', async () => {
    const error = new TypeError('fetch failed');
    const delivered = {
      status: 200,
      text: jest.fn().mockRejectedValue(error),
    } as unknown as Response;
    const fetchRoute = jest
      .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
      .mockResolvedValue(delivered);
    const result = await fetchWithUrlGuard(url, {
      skipInitialValidation: true,
    });
    await expect(result.text()).rejects.toBe(error);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
  });

  it('keeps caller cancellation out of retry and route health', async () => {
    const controller = new AbortController();
    const error = new TypeError('fetch failed');
    const fetchRoute = jest
      .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
      .mockImplementation(async () => {
        controller.abort();
        throw error;
      });
    const failed = jest.spyOn(upstreamPool, 'reportUpstreamRouteFailure');
    await expect(
      fetchWithUrlGuard(url, {
        skipInitialValidation: true,
        signal: controller.signal,
      }),
    ).rejects.toBe(error);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it.each(['direct', proxy])(
    'sends a request body only once (%s)',
    async (first) => {
      process.env.UPSTREAM_PROXY_POOL =
        first === 'direct' ? `direct,${proxy}` : `${proxy},direct`;
      const error = new TypeError('fetch failed');
      const fetchRoute = jest
        .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
        .mockRejectedValueOnce(error)
        .mockResolvedValue(response);
      await expect(
        fetchWithUrlGuard(url, {
          skipInitialValidation: true,
          method: 'POST',
          body: 'payload',
        }),
      ).rejects.toBe(error);
      expect(fetchRoute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['string', 'payload'],
    ['URLSearchParams', new URLSearchParams({ a: '1' })],
  ])(
    'retries a replayable %s body after a connect-phase failure',
    async (_kind, body) => {
      const error = new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect timeout'), {
          code: 'UND_ERR_CONNECT_TIMEOUT',
        }),
      });
      const fetchRoute = jest
        .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
        .mockRejectedValueOnce(error)
        .mockResolvedValue(response);
      await expect(
        fetchWithUrlGuard(url, {
          skipInitialValidation: true,
          method: 'POST',
          body,
        }),
      ).resolves.toBe(response);
      expect(fetchRoute.mock.calls.map(([route]) => route.id)).toEqual([
        'direct',
        proxy,
      ]);
    },
  );

  it.each([undefined, '', 'direct'])(
    'keeps a single direct attempt without a pool (%s)',
    async (configured) => {
      if (configured === undefined) delete process.env.UPSTREAM_PROXY_POOL;
      else process.env.UPSTREAM_PROXY_POOL = configured;
      const error = new TypeError('fetch failed');
      const fetchRoute = jest
        .spyOn(upstreamPool, 'fetchViaUpstreamRoute')
        .mockRejectedValueOnce(error)
        .mockResolvedValue(response);
      await expect(
        fetchWithUrlGuard(url, { skipInitialValidation: true }),
      ).rejects.toBe(error);
      expect(fetchRoute).toHaveBeenCalledTimes(1);
      expect(fetchRoute.mock.calls[0][0]).toEqual({ id: 'direct' });
    },
  );
});

describe('url guard', () => {
  const originalFetch = global.fetch;
  const originalDnsCacheTtl = process.env.PROXY_DNS_CACHE_TTL_MS;
  const originalDevProxyEnabled = process.env.DEV_PROXY_ENABLED;
  const lookup = jest.fn();

  beforeEach(() => {
    clearUrlGuardDnsCacheForTests();
    global.fetch = jest.fn();
    process.env.DEV_PROXY_ENABLED = 'false';
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    setUrlGuardDnsLookupForTests(lookup);
  });

  afterEach(() => {
    if (originalDnsCacheTtl === undefined) {
      delete process.env.PROXY_DNS_CACHE_TTL_MS;
    } else {
      process.env.PROXY_DNS_CACHE_TTL_MS = originalDnsCacheTtl;
    }
    if (originalDevProxyEnabled === undefined) {
      delete process.env.DEV_PROXY_ENABLED;
    } else {
      process.env.DEV_PROXY_ENABLED = originalDevProxyEnabled;
    }
    global.fetch = originalFetch;
    resetUrlGuardDnsLookupForTests();
    jest.useRealTimers();
  });

  it('preserves signed URL escapes through validation and upstream fetch', async () => {
    const url = 'https://example.com/a%25b?signature=a%2Bb%26c%3Dd%25';
    expect(validateProxyUrl(url)).toEqual({ ok: true, url });
    await expect(validateProxyUrlForRequest(url)).resolves.toEqual({
      ok: true,
      url,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ status: 200, body: null });
    await fetchWithUrlGuard(url);
    expect(global.fetch).toHaveBeenCalledWith(url, expect.anything());
    expect(validateProxyUrl(encodeURIComponent(url)).ok).toBe(false);
  });

  it('keeps parent cancellation connected after response headers arrive', async () => {
    let signal: AbortSignal | undefined;
    (global.fetch as jest.Mock).mockImplementation(async (_url, init) => {
      signal = init.signal;
      return { status: 200, body: null };
    });
    const controller = new AbortController();
    await fetchWithUrlGuard('https://example.com/a', {
      signal: controller.signal,
    });
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('blocks local hostnames without DNS lookup', () => {
    expect(validateProxyUrl('http://localhost/a')).toEqual({
      ok: false,
      reason: 'Blocked destination',
    });
  });

  it('blocks private addresses before requests', async () => {
    await expect(
      validateProxyUrlForRequest('http://192.168.1.10/a'),
    ).resolves.toEqual({
      ok: false,
      reason: 'Blocked destination',
    });
  });

  it('blocks ipv4-mapped ipv6 in hex form', () => {
    expect(validateProxyUrl('http://[::ffff:7f00:1]/a')).toEqual({
      ok: false,
      reason: 'Blocked destination',
    });
    expect(
      validateProxyUrl('http://[::ffff:a9fe:a9fe]/latest/meta-data/'),
    ).toEqual({
      ok: false,
      reason: 'Blocked destination',
    });
  });

  it('blocks ipv4-mapped ipv6 in dotted form', () => {
    expect(validateProxyUrl('http://[::ffff:127.0.0.1]/a')).toEqual({
      ok: false,
      reason: 'Blocked destination',
    });
  });

  it('allows ipv4-mapped ipv6 pointing at a public address', () => {
    expect(validateProxyUrl('http://[::ffff:808:808]/a').ok).toBe(true);
  });

  it('blocks redirects to private addresses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      body: null,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location' ? 'http://127.0.0.1/admin' : null,
      },
      status: 302,
    } as Response);

    await expect(fetchWithUrlGuard('https://1.1.1.1/a')).rejects.toThrow(
      'Blocked destination',
    );
  });

  it('caches dns lookups until ttl expires', async () => {
    process.env.PROXY_DNS_CACHE_TTL_MS = '1000';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    await expect(
      validateProxyUrlForRequest('https://example.com/a'),
    ).resolves.toEqual({
      ok: true,
      url: 'https://example.com/a',
    });
    await expect(
      validateProxyUrlForRequest('https://example.com/b'),
    ).resolves.toEqual({
      ok: true,
      url: 'https://example.com/b',
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1001);
    await expect(
      validateProxyUrlForRequest('https://example.com/c'),
    ).resolves.toEqual({
      ok: true,
      url: 'https://example.com/c',
    });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('bounds dns cache size across many distinct hostnames', async () => {
    process.env.PROXY_DNS_CACHE_TTL_MS = '60000';

    for (let i = 0; i < 1500; i += 1) {
      await validateProxyUrlForRequest(`https://h${i}.example.com/a`);
    }
    expect(getUrlGuardDnsCacheSizeForTests()).toBe(1024);

    lookup.mockClear();
    await validateProxyUrlForRequest('https://h1499.example.com/b');
    expect(lookup).not.toHaveBeenCalled();
    await validateProxyUrlForRequest('https://h0.example.com/b');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('drops expired dns entries when the cache overflows', async () => {
    process.env.PROXY_DNS_CACHE_TTL_MS = '1000';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    for (let i = 0; i < 1024; i += 1) {
      await validateProxyUrlForRequest(`https://old${i}.example.com/a`);
    }
    jest.advanceTimersByTime(1001);
    await validateProxyUrlForRequest('https://fresh.example.com/a');

    expect(getUrlGuardDnsCacheSizeForTests()).toBe(1);
  });
});
