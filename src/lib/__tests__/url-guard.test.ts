import {
  fetchWithUrlGuard,
  validateProxyUrl,
  validateProxyUrlForRequest,
} from '../url-guard';

describe('url guard', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
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
});
