import {
  clearUrlGuardDnsCacheForTests,
  fetchWithUrlGuard,
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
});
