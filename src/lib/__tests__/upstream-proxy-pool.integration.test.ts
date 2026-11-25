/** @jest-environment node */

import { Blob, File } from 'node:buffer';
import { createServer, request } from 'node:http';
import {
  type Server,
  type Socket,
  connect,
  createServer as createTcpServer,
} from 'node:net';
import { MessageChannel, MessagePort } from 'node:worker_threads';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { setupDevProxy } from '@/lib/dev-proxy';

import {
  fetchViaUpstreamRoute,
  getUpstreamRoutes,
} from '../upstream-proxy-pool.server';
import { fetchWithUrlGuard } from '../url-guard';

const resourceGuard = jest.requireMock<
  typeof import('../upstream-resource-guard.server')
>('@/lib/upstream-resource-guard.server');

installStreamPolyfills();
const aborted = new AbortController();
aborted.abort();
Object.assign(globalThis, {
  Blob,
  File,
  MessageChannel,
  MessagePort,
  DOMException: aborted.signal.reason.constructor,
});

interface ProxyRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
}

describe('real upstream HTTP proxy', () => {
  const originalPool = process.env.UPSTREAM_PROXY_POOL;
  const originalTimeout = process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS;
  const originalDevProxyEnabled = process.env.DEV_PROXY_ENABLED;
  const originalFetch = global.fetch;
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  const seen: ProxyRequest[] = [];
  const targetRequests = jest.fn();
  let targetUrl: string;
  let proxyUrl: string;

  function track(socket: Socket) {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  }

  async function listen(server: Server): Promise<string> {
    servers.push(server);
    server.on('connection', track);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP server address');
    return `http://127.0.0.1:${address.port}`;
  }

  async function closedProxyUrls(count: number) {
    const closed = await Promise.all(
      Array.from({ length: count }, async () => {
        const server = createServer();
        return { server, url: await listen(server) };
      }),
    );
    await Promise.all(
      closed.map(
        ({ server }) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    return closed.map(({ url }) => url);
  }

  beforeEach(async () => {
    process.env.DEV_PROXY_ENABLED = 'false';
    delete process.env.UPSTREAM_PROXY_POOL;
    getUpstreamRoutes('example.com');
    process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS = '250';
    seen.length = 0;
    targetRequests.mockReset();
    // Jest's node sandbox does not consistently expose Node's native fetch.
    const { fetch: undiciFetch } = await import('undici');
    global.fetch = undiciFetch as unknown as typeof fetch;
    targetUrl = await listen(
      createServer((req, res) => {
        targetRequests(req.url, req.headers['proxy-authorization']);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('target response');
      }),
    );
    const proxy = createServer((req, res) => {
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers['proxy-authorization'],
      });
      const destination = new URL(req.url!);
      const headers = { ...req.headers };
      delete headers['proxy-authorization'];
      const upstream = request(
        destination,
        { method: req.method, headers },
        (reply) => {
          res.writeHead(reply.statusCode!, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on('socket', track);
      upstream.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    proxy.on('connect', (req, client, head) => {
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers['proxy-authorization'],
      });
      const destination = new URL(`http://${req.url}`);
      const upstream = connect(Number(destination.port), destination.hostname);
      track(upstream);
      upstream.on('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    });
    proxyUrl = await listen(proxy);
  });

  afterEach(async () => {
    delete process.env.UPSTREAM_PROXY_POOL;
    getUpstreamRoutes('example.com');
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            if (!server.listening) return resolve();
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    sockets.clear();
    if (originalPool !== undefined)
      process.env.UPSTREAM_PROXY_POOL = originalPool;
    if (originalTimeout === undefined)
      delete process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS;
    else process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS = originalTimeout;
    if (originalDevProxyEnabled === undefined)
      delete process.env.DEV_PROXY_ENABLED;
    else process.env.DEV_PROXY_ENABLED = originalDevProxyEnabled;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    'fetches the real response through CONNECT (authenticated=%s)',
    async (authenticated) => {
      process.env.UPSTREAM_PROXY_POOL = authenticated
        ? proxyUrl.replace('://', '://user:pass@')
        : proxyUrl;
      const route = getUpstreamRoutes('example.com')[0];
      const response = await fetchViaUpstreamRoute(
        route,
        `${targetUrl}/media`,
        {
          signal: AbortSignal.timeout(3000),
        },
      );
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('target response');
      expect(seen).toEqual([
        {
          method: 'CONNECT',
          url: new URL(targetUrl).host,
          authorization: authenticated
            ? `Basic ${Buffer.from('user:pass').toString('base64')}`
            : undefined,
        },
      ]);
      expect(targetRequests).toHaveBeenCalledWith('/media', undefined);
    },
  );

  it('routes pool direct through the active development global dispatcher', async () => {
    const { getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
    const originalDispatcher = getGlobalDispatcher();
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      DEV_PROXY_ENABLED: 'true',
      DEV_HTTP_PROXY: proxyUrl,
      NO_PROXY: 'unused.example',
      UPSTREAM_PROXY_POOL: `direct,${proxyUrl}`,
    };
    try {
      await setupDevProxy();
      const directFetch = jest.spyOn(global, 'fetch');
      const response = await fetchWithUrlGuard(`${targetUrl}/dev-proxy`, {
        skipInitialValidation: true,
        timeoutMs: 3000,
      });
      await expect(response.text()).resolves.toBe('target response');
      expect(directFetch).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([
        {
          method: 'CONNECT',
          url: new URL(targetUrl).host,
          authorization: undefined,
        },
      ]);
      expect(targetRequests).toHaveBeenCalledTimes(1);
    } finally {
      const dispatcher = getGlobalDispatcher();
      setGlobalDispatcher(originalDispatcher);
      process.env = originalEnv;
      if (dispatcher !== originalDispatcher) await dispatcher.close();
    }
  });

  it('fails over from a closed proxy port to a working proxy without direct fetch', async () => {
    const [unavailable] = await closedProxyUrls(1);
    process.env.UPSTREAM_PROXY_POOL = `${unavailable},${proxyUrl}`;
    const attempts = jest.spyOn(resourceGuard, 'withUpstreamResponse');
    const directFetch = jest.spyOn(global, 'fetch');
    const response = await fetchWithUrlGuard(`${targetUrl}/failover`, {
      skipInitialValidation: true,
      timeoutMs: 3000,
    });
    await expect(response.text()).resolves.toBe('target response');
    expect(seen).toHaveLength(1);
    expect(targetRequests).toHaveBeenCalledTimes(1);
    expect(attempts.mock.calls.map((call) => call[2]?.cooldownScope)).toEqual([
      unavailable,
      proxyUrl,
    ]);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('falls back to direct when both proxy ports are closed', async () => {
    const [first, second] = await closedProxyUrls(2);
    expect(first).not.toBe(second);
    process.env.UPSTREAM_PROXY_POOL = `${first},${second}`;
    const attempts = jest.spyOn(resourceGuard, 'withUpstreamResponse');
    const directFetch = jest.spyOn(global, 'fetch');
    const response = await fetchWithUrlGuard(`${targetUrl}/direct`, {
      skipInitialValidation: true,
      timeoutMs: 3000,
    });
    await expect(response.text()).resolves.toBe('target response');
    expect(directFetch).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
    expect(targetRequests).toHaveBeenCalledWith('/direct', undefined);
    expect(attempts.mock.calls.map((call) => call[2]?.cooldownScope)).toEqual([
      first,
      second,
      undefined,
    ]);
  });

  it('limits direct TLS connection establishment in pool mode', async () => {
    process.env.UPSTREAM_PROXY_POOL = `direct,${proxyUrl}`;
    const stalled = await listen(createTcpServer());
    const error = await fetchViaUpstreamRoute(
      { id: 'direct' },
      stalled.replace('http:', 'https:'),
      { signal: AbortSignal.timeout(3000) },
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error & { cause?: { code?: string } }).cause?.code).toBe(
      'UND_ERR_CONNECT_TIMEOUT',
    );
  });

  it('allows direct response bodies to outlast the connect timeout', async () => {
    process.env.UPSTREAM_PROXY_POOL = `direct,${proxyUrl}`;
    const slow = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.flushHeaders();
        const timer = setTimeout(() => res.end('slow body'), 500);
        res.on('close', () => clearTimeout(timer));
      }),
    );
    const response = await fetchWithUrlGuard(slow, {
      skipInitialValidation: true,
      timeoutMs: 3000,
    });
    await expect(response.text()).resolves.toBe('slow body');
    expect(seen).toHaveLength(0);
  });

  it('bypasses a working proxy when useProxyPool is false', async () => {
    process.env.UPSTREAM_PROXY_POOL = proxyUrl;
    const directFetch = jest.spyOn(global, 'fetch');
    const response = await fetchWithUrlGuard(`${targetUrl}/direct`, {
      skipInitialValidation: true,
      useProxyPool: false,
      timeoutMs: 3000,
    });
    await expect(response.text()).resolves.toBe('target response');
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
  });
});
