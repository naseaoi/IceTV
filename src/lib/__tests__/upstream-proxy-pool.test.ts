/** @jest-environment node */

import {
  fetchViaUpstreamRoute,
  getUpstreamRoutes,
  isUpstreamNetworkFailure,
  reportUpstreamRouteFailure,
  reportUpstreamRouteSuccess,
} from '../upstream-proxy-pool.server';

jest.mock('undici', () => ({
  Agent: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
  ProxyAgent: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
  fetch: jest.fn(),
}));

const undici = jest.requireMock<typeof import('undici')>('undici');

const nodes = [
  'http://127.0.0.1:7891',
  'http://127.0.0.1:7892',
  'http://127.0.0.1:7893',
  'http://127.0.0.1:7894',
];
const ids = (key?: string) =>
  getUpstreamRoutes('example.com', key).map((route) => route.id);

describe('upstream proxy pool', () => {
  const originalPool = process.env.UPSTREAM_PROXY_POOL;
  const originalTimeout = process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS;
  const originalDevProxyEnabled = process.env.DEV_PROXY_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEV_PROXY_ENABLED = 'false';
    delete process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS;
    delete process.env.UPSTREAM_PROXY_POOL;
    getUpstreamRoutes('example.com');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.UPSTREAM_PROXY_POOL;
    getUpstreamRoutes('example.com');
    if (originalPool !== undefined)
      process.env.UPSTREAM_PROXY_POOL = originalPool;
    if (originalTimeout === undefined)
      delete process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS;
    else process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS = originalTimeout;
    if (originalDevProxyEnabled === undefined)
      delete process.env.DEV_PROXY_ENABLED;
    else process.env.DEV_PROXY_ENABLED = originalDevProxyEnabled;
    jest.restoreAllMocks();
  });

  it.each([undefined, '', ' \t\n ', 'direct', 'DIRECT, direct'])(
    'uses only direct when the pool is disabled: %s',
    (value) => {
      if (value === undefined) delete process.env.UPSTREAM_PROXY_POOL;
      else process.env.UPSTREAM_PROXY_POOL = value;
      expect(getUpstreamRoutes('example.com', 'user')).toEqual([
        { id: 'direct' },
      ]);
    },
  );

  it('parses supported schemes and comma or whitespace separators', () => {
    const entries = [
      'http://user:pass@proxy.example:7891',
      'https://proxy.example:7892',
      'socks5://proxy.example:7893',
      'socks://proxy.example:7894',
    ];
    process.env.UPSTREAM_PROXY_POOL = `${entries[0]},${entries[1]}\n${entries[2]}\t${entries[3]}`;
    const firstRoutes = entries.map(() => getUpstreamRoutes('example.com')[0]);
    expect(firstRoutes.map((route) => route.id)).toEqual([
      'http://proxy.example:7891',
      ...entries.slice(1),
    ]);
    expect(firstRoutes.map((route) => route.proxyUrl)).toEqual([
      `${entries[0]}/`,
      `${entries[1]}/`,
      ...entries.slice(2),
    ]);
  });

  it('skips invalid entries and logs only their positions without credentials', () => {
    process.env.UPSTREAM_PROXY_POOL =
      `ftp://private-user:private-password@proxy.example:21,` +
      `broken-private-user:private-password ${nodes[0]}`;
    expect(ids()).toEqual([nodes[0], 'direct']);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenNthCalledWith(1, expect.any(String), {
      position: 1,
    });
    expect(console.warn).toHaveBeenNthCalledWith(2, expect.any(String), {
      position: 2,
    });
    const logs = JSON.stringify(jest.mocked(console.warn).mock.calls);
    for (const secret of ['private-user', 'private-password', 'proxy.example'])
      expect(logs).not.toContain(secret);
    getUpstreamRoutes('example.com');
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('deduplicates normalized endpoints and direct while keeping the first credentials', () => {
    process.env.UPSTREAM_PROXY_POOL =
      'http://first:secret@PROXY.example:80,http://second:other@proxy.example,direct,DIRECT';
    expect(getUpstreamRoutes('example.com')).toEqual([
      {
        id: 'http://proxy.example',
        proxyUrl: 'http://first:secret@proxy.example/',
      },
      { id: 'direct' },
    ]);
    expect(ids()).toEqual(['direct', 'http://proxy.example']);
  });

  it('keeps sticky ordering stable and distributes identities across nodes', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.join(',');
    const selected = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const key = `user:${index}`;
      const routes = ids(key);
      expect(ids(key)).toEqual(routes);
      expect(routes).toHaveLength(3);
      expect(routes[2]).toBe('direct');
      expect(new Set(routes).size).toBe(3);
      selected.add(routes[0]);
    }
    expect(selected).toEqual(new Set(nodes));
  });

  it('rotates without a sticky identity and caps proxy attempts at two', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.join(',');
    for (let index = 0; index < nodes.length * 2; index++)
      expect(ids()).toEqual([
        nodes[index % nodes.length],
        nodes[(index + 1) % nodes.length],
        'direct',
      ]);
  });

  it('skips an offline node without remapping identities assigned elsewhere', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.join(',');
    const keys = Array.from({ length: 200 }, (_, index) => `user:${index}`);
    const before = keys.map((key) => getUpstreamRoutes('example.com', key));
    const offline = before[0][0];
    for (let index = 0; index < 3; index++)
      reportUpstreamRouteFailure(offline, 'example.com');
    let moved = 0;
    let unchanged = 0;
    keys.forEach((key, index) => {
      const after = ids(key);
      expect(after).not.toContain(offline.id);
      if (before[index][0].id === offline.id) {
        expect(after[0]).toBe(before[index][1].id);
        moved++;
      } else {
        expect(after[0]).toBe(before[index][0].id);
        unchanged++;
        if (before[index][1].id !== offline.id)
          expect(after).toEqual(before[index].map((route) => route.id));
      }
    });
    expect(moved).toBeGreaterThan(0);
    expect(unchanged).toBeGreaterThan(0);
  });

  it('trips after three failures and doubles probation backoff up to five minutes', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes[0];
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const route = getUpstreamRoutes('example.com')[0];
    for (let index = 0; index < 2; index++) {
      reportUpstreamRouteFailure(route, 'example.com');
      expect(ids()).toContain(route.id);
    }
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      reportUpstreamRouteFailure(route, 'example.com');
      expect(ids()).toEqual(['direct']);
      now += delay - 1;
      expect(ids()).toEqual(['direct']);
      now++;
      expect(ids()).toEqual([route.id, 'direct']);
    }
  });

  it('ignores in-flight failures while offline without extending or increasing backoff', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes[0];
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const route = getUpstreamRoutes('example.com')[0];
    for (let index = 0; index < 3; index++)
      reportUpstreamRouteFailure(route, 'example.com');
    now += 10_000;
    for (let index = 0; index < 20; index++)
      reportUpstreamRouteFailure(route, 'example.com');
    now += 20_000;
    expect(ids()).toContain(route.id);
    reportUpstreamRouteFailure(route, 'example.com');
    now += 59_999;
    expect(ids()).toEqual(['direct']);
    now++;
    expect(ids()).toContain(route.id);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('resets consecutive failures and probation backoff after a success', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes[0];
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const route = getUpstreamRoutes('example.com')[0];
    reportUpstreamRouteFailure(route, 'example.com');
    reportUpstreamRouteFailure(route, 'example.com');
    reportUpstreamRouteSuccess(route, 'example.com');
    reportUpstreamRouteFailure(route, 'example.com');
    reportUpstreamRouteFailure(route, 'example.com');
    expect(ids()).toContain(route.id);
    reportUpstreamRouteFailure(route, 'example.com');
    now += 30_000;
    reportUpstreamRouteSuccess(route, 'example.com');
    reportUpstreamRouteFailure(route, 'example.com');
    reportUpstreamRouteFailure(route, 'example.com');
    expect(ids()).toContain(route.id);
    reportUpstreamRouteFailure(route, 'example.com');
    now += 30_000;
    expect(ids()).toContain(route.id);
  });

  it('rebuilds health and round-robin state when the environment changes', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.slice(0, 2).join(',');
    const route = getUpstreamRoutes('example.com')[0];
    for (let index = 0; index < 3; index++)
      reportUpstreamRouteFailure(route, 'example.com');
    expect(ids()).not.toContain(route.id);
    process.env.UPSTREAM_PROXY_POOL = nodes.slice(0, 2).join(' ');
    expect(ids()).toEqual([nodes[0], nodes[1], 'direct']);
  });

  it('bypasses the pool explicitly without advancing its rotation', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.join(',');
    expect(getUpstreamRoutes('example.com', 'user', false)).toEqual([
      { id: 'direct' },
    ]);
    expect(ids()[0]).toBe(nodes[0]);
  });

  it.each([true, false])(
    'isolates direct health by hostname (explicit direct=%s)',
    (explicitDirect) => {
      process.env.UPSTREAM_PROXY_POOL = explicitDirect
        ? `direct,${nodes[0]}`
        : nodes[0];
      const direct = { id: 'direct' };
      getUpstreamRoutes('example.com');
      for (let index = 0; index < 2; index++) {
        reportUpstreamRouteFailure(direct, 'EXAMPLE.COM.');
        expect(ids()).toContain('direct');
      }
      reportUpstreamRouteFailure(direct, 'example.com');
      expect(ids()).toEqual([nodes[0]]);
      expect(
        getUpstreamRoutes('other.example').map((route) => route.id),
      ).toContain('direct');
      reportUpstreamRouteSuccess(direct, 'other.example');
      expect(ids()).toEqual([nodes[0]]);
      reportUpstreamRouteSuccess(direct, 'example.com');
      expect(ids()).toContain('direct');
    },
  );

  it('restores direct after backoff and resets its failures after success', () => {
    process.env.UPSTREAM_PROXY_POOL = `direct,${nodes[0]}`;
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const direct = getUpstreamRoutes('example.com')[0];
    for (let index = 0; index < 2; index++)
      reportUpstreamRouteFailure(direct, 'example.com');
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      reportUpstreamRouteFailure(direct, 'example.com');
      expect(ids()).toEqual([nodes[0]]);
      reportUpstreamRouteFailure(direct, 'example.com');
      now += delay - 1;
      expect(ids()).toEqual([nodes[0]]);
      now++;
      expect(ids()).toContain('direct');
    }
    reportUpstreamRouteSuccess(direct, 'example.com');
    for (let index = 0; index < 2; index++)
      reportUpstreamRouteFailure(direct, 'example.com');
    expect(ids()).toContain('direct');
    reportUpstreamRouteFailure(direct, 'example.com');
    now += 30_000;
    expect(ids()).toContain('direct');
  });

  it('keeps direct as the final fallback when all routes are down', () => {
    process.env.UPSTREAM_PROXY_POOL = `direct,${nodes[0]}`;
    const routes = getUpstreamRoutes('example.com');
    for (const route of routes)
      for (let index = 0; index < 3; index++)
        reportUpstreamRouteFailure(route, 'example.com');
    expect(ids()).toEqual(['direct']);
  });

  it('bounds direct health records while retaining recent failures', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes[0];
    getUpstreamRoutes('example.com');
    for (let host = 0; host <= 1024; host++)
      for (let failure = 0; failure < 3; failure++)
        reportUpstreamRouteFailure({ id: 'direct' }, `${host}.example`);
    expect(getUpstreamRoutes('0.example').map((route) => route.id)).toContain(
      'direct',
    );
    expect(getUpstreamRoutes('1024.example').map((route) => route.id)).toEqual([
      nodes[0],
    ]);
  });

  it.each([undefined, '750', 'invalid', '0'])(
    'caches a direct Agent with only a connect timeout (%s)',
    async (configured) => {
      process.env.UPSTREAM_PROXY_POOL = nodes[0];
      if (configured !== undefined)
        process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS = configured;
      const response = { status: 200 } as Awaited<
        ReturnType<typeof undici.fetch>
      >;
      jest.mocked(undici.fetch).mockResolvedValue(response);
      for (let index = 0; index < 2; index++)
        await expect(
          fetchViaUpstreamRoute({ id: 'direct' }, 'https://example.com', {}),
        ).resolves.toBe(response);
      expect(undici.Agent).toHaveBeenCalledTimes(1);
      expect(undici.Agent).toHaveBeenCalledWith({
        connect: { timeout: configured === '750' ? 750 : 5000 },
      });
      expect(undici.fetch).toHaveBeenCalledWith('https://example.com', {
        dispatcher: jest.mocked(undici.Agent).mock.results[0].value,
      });
    },
  );

  it.each(['development', 'production'] as const)(
    'preserves the development global dispatcher only outside production (%s)',
    async (nodeEnv) => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        NODE_ENV: nodeEnv,
        DEV_PROXY_ENABLED: 'true',
        DEV_HTTP_PROXY: nodes[1],
        UPSTREAM_PROXY_POOL: `direct,${nodes[0]}`,
      };
      const response = { status: 200 } as Response;
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(response);
      jest
        .mocked(undici.fetch)
        .mockResolvedValue(
          response as unknown as Awaited<ReturnType<typeof undici.fetch>>,
        );
      const init = { method: 'HEAD' };
      try {
        await expect(
          fetchViaUpstreamRoute({ id: 'direct' }, 'https://example.com', init),
        ).resolves.toBe(response);
        if (nodeEnv === 'development') {
          expect(global.fetch).toHaveBeenCalledWith(
            'https://example.com',
            init,
          );
          expect(undici.Agent).not.toHaveBeenCalled();
          expect(undici.fetch).not.toHaveBeenCalled();
        } else {
          expect(global.fetch).not.toHaveBeenCalled();
          expect(undici.Agent).toHaveBeenCalledTimes(1);
          expect(undici.fetch).toHaveBeenCalledTimes(1);
        }
      } finally {
        global.fetch = originalFetch;
        process.env = originalEnv;
      }
    },
  );

  it('never puts direct routing into a failed state without a pool', () => {
    const route = getUpstreamRoutes('example.com')[0];
    for (let index = 0; index < 5; index++)
      reportUpstreamRouteFailure(route, 'example.com');
    reportUpstreamRouteSuccess(route, 'example.com');
    expect(ids()).toEqual(['direct']);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'direct', nodes[0]])(
    'uses global fetch unchanged without a pool or when bypassed (%s)',
    async (configured) => {
      if (configured !== undefined)
        process.env.UPSTREAM_PROXY_POOL = configured;
      const response = { status: 200 } as Response;
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(response);
      const init = { method: 'HEAD' };
      try {
        await expect(
          fetchViaUpstreamRoute(
            { id: 'direct' },
            'https://example.com',
            init,
            configured !== nodes[0],
          ),
        ).resolves.toBe(response);
        expect(global.fetch).toHaveBeenCalledWith('https://example.com', init);
        expect(undici.Agent).not.toHaveBeenCalled();
        expect(undici.fetch).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    },
  );

  it.each([
    [new TypeError('fetch failed'), true],
    [new Error('fetch failed'), false],
    [new TypeError('invalid URL'), false],
    [{ message: 'fetch failed' }, false],
    [null, false],
  ])('recognizes only fetch network failures: %s', (error, expected) => {
    expect(isUpstreamNetworkFailure(error)).toBe(expected);
  });
});
