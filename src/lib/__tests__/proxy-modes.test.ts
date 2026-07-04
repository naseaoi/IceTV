describe('proxy modes', () => {
  async function loadModule(modes: Record<string, string>) {
    jest.resetModules();
    sessionStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => modes,
    });
    const mod = require('../proxy-modes') as typeof import('../proxy-modes.js');
    await mod.getProxyModes();
    return mod;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.clear();
  });

  it('uses configured fixed routes', async () => {
    const mod = await loadModule({
      browserSource: 'browser',
      serverSource: 'server',
      autoSource: 'auto',
    });

    expect(
      mod.shouldUseServerProxy('browserSource', 'https://example.com/a.m3u8'),
    ).toBe(false);
    expect(
      mod.shouldUseServerProxy('serverSource', 'https://example.com/a.m3u8'),
    ).toBe(true);
    expect(
      mod.shouldUseServerProxy('autoSource', 'https://example.com/a.m3u8'),
    ).toBe(false);
  });

  it('stores automatic fallback per source and url', async () => {
    const mod = await loadModule({ autoSource: 'auto' });
    const firstUrl = 'https://cdn.example.com/show/1/index.m3u8';
    const secondUrl = 'https://cdn.example.com/show/2/index.m3u8';

    mod.rememberSourceServerProxy('autoSource', firstUrl);

    expect(mod.shouldUseServerProxy('autoSource', firstUrl)).toBe(true);
    expect(mod.shouldUseServerProxy('autoSource', secondUrl)).toBe(false);

    mod.clearSourceProxyOverride('autoSource', firstUrl);

    expect(mod.shouldUseServerProxy('autoSource', firstUrl)).toBe(false);
  });

  it('does not store automatic fallback for fixed browser mode', async () => {
    const mod = await loadModule({ browserSource: 'browser' });
    const url = 'https://cdn.example.com/show/1/index.m3u8';

    mod.rememberSourceServerProxy('browserSource', url);

    expect(mod.shouldUseServerProxy('browserSource', url)).toBe(false);
  });

  it('drops legacy source-wide overrides when url is provided', async () => {
    const mod = await loadModule({ autoSource: 'auto' });
    sessionStorage.setItem(
      'icetv_proxy_mode_overrides',
      JSON.stringify({
        autoSource: { mode: 'server', at: Date.now() },
      }),
    );

    expect(
      mod.shouldUseServerProxy(
        'autoSource',
        'https://cdn.example.com/show/1/index.m3u8',
      ),
    ).toBe(false);
    expect(sessionStorage.getItem('icetv_proxy_mode_overrides')).not.toContain(
      '"autoSource"',
    );
  });
});
