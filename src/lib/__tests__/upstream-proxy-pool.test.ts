/** @jest-environment node */

import {
  fetchViaUpstreamRoute,
  getUpstreamRoutes,
  isUpstreamNetworkFailure,
  reportUpstreamRouteFailure,
  reportUpstreamRouteSuccess,
} from '../upstream-proxy-pool.server';

const nodes = [
  'http://127.0.0.1:7891',
  'http://127.0.0.1:7892',
  'http://127.0.0.1:7893',
  'http://127.0.0.1:7894',
];
const ids = (key?: string) => getUpstreamRoutes(key).map((route) => route.id);

describe('upstream proxy pool', () => {
  const originalPool = process.env.UPSTREAM_PROXY_POOL;

  beforeEach(() => {
    delete process.env.UPSTREAM_PROXY_POOL;
    getUpstreamRoutes();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.UPSTREAM_PROXY_POOL;
    getUpstreamRoutes();
    if (originalPool !== undefined)
      process.env.UPSTREAM_PROXY_POOL = originalPool;
    jest.restoreAllMocks();
  });

  it.each([undefined, '', ' \t\n ', 'direct', 'DIRECT, direct'])(
    'uses only direct when the pool is disabled: %s',
    (value) => {
      if (value === undefined) delete process.env.UPSTREAM_PROXY_POOL;
      else process.env.UPSTREAM_PROXY_POOL = value;
      expect(getUpstreamRoutes('user')).toEqual([{ id: 'direct' }]);
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
    const firstRoutes = entries.map(() => getUpstreamRoutes()[0]);
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
    getUpstreamRoutes();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('deduplicates normalized endpoints and direct while keeping the first credentials', () => {
    process.env.UPSTREAM_PROXY_POOL =
      'http://first:secret@PROXY.example:80,http://second:other@proxy.example,direct,DIRECT';
    expect(getUpstreamRoutes()).toEqual([
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
    const before = keys.map((key) => getUpstreamRoutes(key));
    const offline = before[0][0];
    for (let index = 0; index < 3; index++) reportUpstreamRouteFailure(offline);
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
    const route = getUpstreamRoutes()[0];
    for (let index = 0; index < 2; index++) {
      reportUpstreamRouteFailure(route);
      expect(ids()).toContain(route.id);
    }
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      reportUpstreamRouteFailure(route);
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
    const route = getUpstreamRoutes()[0];
    for (let index = 0; index < 3; index++) reportUpstreamRouteFailure(route);
    now += 10_000;
    for (let index = 0; index < 20; index++) reportUpstreamRouteFailure(route);
    now += 20_000;
    expect(ids()).toContain(route.id);
    reportUpstreamRouteFailure(route);
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
    const route = getUpstreamRoutes()[0];
    reportUpstreamRouteFailure(route);
    reportUpstreamRouteFailure(route);
    reportUpstreamRouteSuccess(route);
    reportUpstreamRouteFailure(route);
    reportUpstreamRouteFailure(route);
    expect(ids()).toContain(route.id);
    reportUpstreamRouteFailure(route);
    now += 30_000;
    reportUpstreamRouteSuccess(route);
    reportUpstreamRouteFailure(route);
    reportUpstreamRouteFailure(route);
    expect(ids()).toContain(route.id);
    reportUpstreamRouteFailure(route);
    now += 30_000;
    expect(ids()).toContain(route.id);
  });

  it('rebuilds health and round-robin state when the environment changes', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.slice(0, 2).join(',');
    const route = getUpstreamRoutes()[0];
    for (let index = 0; index < 3; index++) reportUpstreamRouteFailure(route);
    expect(ids()).not.toContain(route.id);
    process.env.UPSTREAM_PROXY_POOL = nodes.slice(0, 2).join(' ');
    expect(ids()).toEqual([nodes[0], nodes[1], 'direct']);
  });

  it('bypasses the pool explicitly without advancing its rotation', () => {
    process.env.UPSTREAM_PROXY_POOL = nodes.join(',');
    expect(getUpstreamRoutes('user', false)).toEqual([{ id: 'direct' }]);
    expect(ids()[0]).toBe(nodes[0]);
  });

  it('never puts direct routing into a failed state', () => {
    const route = getUpstreamRoutes()[0];
    for (let index = 0; index < 5; index++) reportUpstreamRouteFailure(route);
    reportUpstreamRouteSuccess(route);
    expect(ids()).toEqual(['direct']);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('uses global fetch unchanged for direct requests', async () => {
    const response = { status: 200 } as Response;
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(response);
    const init = { method: 'HEAD' };
    try {
      await expect(
        fetchViaUpstreamRoute({ id: 'direct' }, 'https://example.com', init),
      ).resolves.toBe(response);
      expect(global.fetch).toHaveBeenCalledWith('https://example.com', init);
    } finally {
      global.fetch = originalFetch;
    }
  });

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
