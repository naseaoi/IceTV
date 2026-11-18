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
