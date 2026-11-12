describe('proxy modes', () => {
  async function loadModule(modes: Record<string, string>) {
    jest.resetModules();
    sessionStorage.clear();
    jest.doMock('@/lib/auth.client', () => ({
      getAuthInfoFromBrowserCookie: () => ({ username: 'alice' }),
    }));
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

  it('coalesces pending preload and playback route resolution', async () => {
    await loadModule({});
    jest.resetModules();
    let respond!: (value: unknown) => void;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    ) as jest.Mock;
    const mod = require('../proxy-modes') as typeof import('../proxy-modes.js');
    mod.preloadProxyModes();
    const route = mod.resolveSourcePlaybackRoute(
      'demo',
      'https://cdn.example/a.m3u8',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    respond({ ok: true, json: async () => ({ demo: 'server' }) });
    await expect(route).resolves.toEqual({
      useServerProxy: true,
      directManifest: false,
      allowAutoFallback: false,
    });
  });

  it('bounds a stalled request, preserves the fallback snapshot and allows retries', async () => {
    await loadModule({});
    jest.resetModules();
    jest.useFakeTimers();
    try {
      let respond!: (value: unknown) => void;
      global.fetch = jest.fn(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      ) as jest.Mock;
      const mod =
        require('../proxy-modes') as typeof import('../proxy-modes.js');
      const pending = mod.resolveSourcePlaybackRoute(
        'demo',
        'https://cdn.example/a.m3u8',
      );
      jest.advanceTimersByTime(2_000);
      const route = await pending;
      expect(route).toEqual({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: true,
      });
      expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
      respond({ ok: true, json: async () => ({ demo: 'browser' }) });
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ demo: 'server' }),
      });
      await expect(
        mod.resolveSourcePlaybackRoute('demo', 'https://cdn.example/a.m3u8'),
      ).resolves.toEqual({
        useServerProxy: true,
        directManifest: false,
        allowAutoFallback: false,
      });
      expect(route.allowAutoFallback).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back immediately on request failure', async () => {
    await loadModule({});
    jest.resetModules();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const mod = require('../proxy-modes') as typeof import('../proxy-modes.js');
    await expect(
      mod.resolveSourcePlaybackRoute('demo', 'https://cdn.example/a.m3u8'),
    ).resolves.toEqual({
      useServerProxy: false,
      directManifest: true,
      allowAutoFallback: true,
    });
  });

  it.each([
    ['browser', false, true, false],
    ['server', true, false, false],
    ['auto', false, true, true],
  ])(
    'resolves %s without confusing segment and manifest routes',
    async (mode, useServerProxy, directManifest, allowAutoFallback) => {
      const modes = { demo: mode as string };
      const mod = await loadModule(modes);
      const url = 'https://cdn.example/a.m3u8';
      const expected = { useServerProxy, directManifest, allowAutoFallback };
      expect(mod.getSourcePlaybackRoute('demo', url, modes)).toEqual(expected);
      await expect(
        mod.resolveSourcePlaybackRoute('demo', url),
      ).resolves.toEqual(expected);
      mod.rememberSourceServerProxy('demo', url);
      expect(mod.getSourcePlaybackRoute('demo', url)).toEqual({
        ...expected,
        useServerProxy: mode === 'browser' ? false : true,
        directManifest: mode === 'browser',
      });
    },
  );

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

  it('uses automatic routing for sources without an explicit mode', async () => {
    const mod = await loadModule({});
    const url = 'https://cdn.example.com/show/1/index.m3u8';

    expect(mod.shouldUseServerProxy('missingSource', url)).toBe(false);

    mod.rememberSourceServerProxy('missingSource', url);

    expect(mod.shouldUseServerProxy('missingSource', url)).toBe(true);
  });

  it('stores automatic fallback per source and manifest host', async () => {
    const mod = await loadModule({ autoSource: 'auto' });
    const firstUrl = 'https://cdn.example.com/show/1/index.m3u8';
    const secondUrl = 'https://cdn.example.com/show/2/index.m3u8';

    mod.rememberSourceServerProxy('autoSource', firstUrl);

    expect(mod.shouldUseServerProxy('autoSource', firstUrl)).toBe(true);
    expect(mod.shouldUseServerProxy('autoSource', secondUrl)).toBe(true);
    expect(
      mod.shouldUseServerProxy('autoSource', 'https://other.example/a.m3u8'),
    ).toBe(false);
    expect(mod.shouldUseServerProxy('otherSource', firstUrl)).toBe(false);

    mod.clearSourceProxyOverride('autoSource', firstUrl);

    expect(mod.shouldUseServerProxy('autoSource', firstUrl)).toBe(false);
  });

  it('expires host memory after thirty minutes', async () => {
    const mod = await loadModule({ demo: 'auto' });
    const url = 'https://cdn.example/a.m3u8';
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mod.rememberSourceServerProxy('demo', url);
    expect(mod.getSourcePlaybackRoute('demo', url).useServerProxy).toBe(true);
    jest.spyOn(Date, 'now').mockReturnValue(now + 30 * 60 * 1000 + 1);
    expect(mod.getSourcePlaybackRoute('demo', url).directManifest).toBe(true);
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
