import 'server-only';

import type { Dispatcher } from 'undici';

export interface UpstreamRoute {
  readonly id: string;
  readonly proxyUrl?: string;
}

interface NodeHealth {
  failures: number;
  downUntil: number;
  backoffMs: number;
}

const DIRECT_ROUTE: UpstreamRoute = { id: 'direct' };
const DIRECT_ONLY: readonly UpstreamRoute[] = [DIRECT_ROUTE];
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks:']);
const MAX_ROUTED_ATTEMPTS = 2;
const FAILURE_THRESHOLD = 3;
const MIN_DOWN_MS = 30_000;
const MAX_DOWN_MS = 300_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

let pool: { raw: string; routes: UpstreamRoute[] } | undefined;
let roundRobin = 0;
const health = new Map<string, NodeHealth>();
const dispatchers = new Map<string, Promise<Dispatcher>>();

function loadPool(): UpstreamRoute[] {
  const raw = process.env.UPSTREAM_PROXY_POOL?.trim() ?? '';
  if (pool?.raw === raw) return pool.routes;
  for (const dispatcher of dispatchers.values())
    void dispatcher.then((agent) => agent.close()).catch(() => {});
  dispatchers.clear();
  health.clear();
  roundRobin = 0;
  pool = { raw, routes: parsePool(raw) };
  return pool.routes;
}

function parsePool(raw: string): UpstreamRoute[] {
  const routes: UpstreamRoute[] = [];
  const seen = new Set<string>();
  raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .forEach((entry, index) => {
      if (entry.toLowerCase() === DIRECT_ROUTE.id) {
        if (!seen.has(DIRECT_ROUTE.id)) routes.push(DIRECT_ROUTE);
        seen.add(DIRECT_ROUTE.id);
        return;
      }
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        url = new URL('invalid:');
      }
      if (!SUPPORTED_PROTOCOLS.has(url.protocol) || !url.hostname) {
        // 条目可能含凭据，只报位置
        console.warn('UPSTREAM_PROXY_POOL 条目无效，已跳过', {
          position: index + 1,
        });
        return;
      }
      const id = `${url.protocol}//${url.host}`;
      if (seen.has(id)) return;
      seen.add(id);
      routes.push({ id, proxyUrl: url.toString() });
    });
  return routes.some((route) => route.proxyUrl) ? routes : [];
}

export function isUpstreamProxyPoolConfigured(): boolean {
  return loadPool().length > 0;
}

function connectTimeoutMs(): number {
  const value = Number(process.env.UPSTREAM_PROXY_CONNECT_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_CONNECT_TIMEOUT_MS;
}

function stickyScore(key: string, id: string): number {
  // FNV-1a；只用于把同一标识稳定映射到同一节点
  let hash = 0x811c9dc5;
  const input = `${key}|${id}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function isAvailable(route: UpstreamRoute, now: number): boolean {
  return !route.proxyUrl || (health.get(route.id)?.downUntil ?? 0) <= now;
}

// 有标识时按最高随机权重哈希固定出口：节点下线只让原本分到它的标识顺延
export function getUpstreamRoutes(
  stickyKey?: string,
  usePool = true,
): readonly UpstreamRoute[] {
  if (!usePool) return DIRECT_ONLY;
  const routes = loadPool();
  if (routes.length === 0) return DIRECT_ONLY;
  let ordered: UpstreamRoute[];
  if (stickyKey) {
    ordered = routes
      .map((route) => ({ route, score: stickyScore(stickyKey, route.id) }))
      .sort((a, b) => b.score - a.score)
      .map(({ route }) => route);
  } else {
    const start = roundRobin;
    roundRobin = (roundRobin + 1) % routes.length;
    ordered = [...routes.slice(start), ...routes.slice(0, start)];
  }
  const now = Date.now();
  const picked = ordered
    .filter((route) => isAvailable(route, now))
    .slice(0, MAX_ROUTED_ATTEMPTS);
  if (!picked.includes(DIRECT_ROUTE)) picked.push(DIRECT_ROUTE);
  return picked;
}

function dispatcherFor(proxyUrl: string): Promise<Dispatcher> {
  let dispatcher = dispatchers.get(proxyUrl);
  if (!dispatcher) {
    dispatcher = import('undici').then(
      ({ ProxyAgent }) =>
        new ProxyAgent({
          uri: proxyUrl,
          proxyTls: { timeout: connectTimeoutMs() },
        }),
    );
    dispatchers.set(proxyUrl, dispatcher);
  }
  return dispatcher;
}

export async function fetchViaUpstreamRoute(
  route: UpstreamRoute,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!route.proxyUrl) return fetch(url, init);
  // 内置 fetch 的 undici 版本与依赖不同，代理请求统一用依赖自带的 fetch
  const [{ fetch: undiciFetch }, dispatcher] = await Promise.all([
    import('undici'),
    dispatcherFor(route.proxyUrl),
  ]);
  const response = await undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher,
  });
  return response as unknown as Response;
}

export function isUpstreamNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && error.message === 'fetch failed';
}

export function reportUpstreamRouteSuccess(route: UpstreamRoute): void {
  if (!route.proxyUrl) return;
  const state = health.get(route.id);
  if (!state) return;
  if (state.backoffMs > 0)
    console.info('Upstream proxy node recovered', { node: route.id });
  health.delete(route.id);
}

export function reportUpstreamRouteFailure(route: UpstreamRoute): void {
  if (!route.proxyUrl) return;
  const now = Date.now();
  const state = health.get(route.id) ?? {
    failures: 0,
    downUntil: 0,
    backoffMs: 0,
  };
  // 下线期间仍在途的请求失败不再累计，避免一次故障把冷却翻倍到上限
  if (state.downUntil > now) return;
  state.failures += 1;
  if (state.backoffMs > 0 || state.failures >= FAILURE_THRESHOLD) {
    state.backoffMs = state.backoffMs
      ? Math.min(state.backoffMs * 2, MAX_DOWN_MS)
      : MIN_DOWN_MS;
    state.downUntil = now + state.backoffMs;
    state.failures = 0;
    console.warn('Upstream proxy node down', {
      node: route.id,
      seconds: state.backoffMs / 1000,
    });
  }
  health.set(route.id, state);
}
