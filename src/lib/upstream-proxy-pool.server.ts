import 'server-only';

import type { Dispatcher } from 'undici';

import { isDevProxyActive } from '@/lib/dev-proxy';

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
const MAX_DIRECT_HEALTH_ENTRIES = 1024;

let pool: { raw: string; routes: UpstreamRoute[] } | undefined;
let roundRobin = 0;
const health = new Map<string, NodeHealth>();
const directHealth = new Map<string, NodeHealth>();
const dispatchers = new Map<string, Promise<Dispatcher>>();

function loadPool(): UpstreamRoute[] {
  const raw = process.env.UPSTREAM_PROXY_POOL?.trim() ?? '';
  if (pool?.raw === raw) return pool.routes;
  for (const dispatcher of dispatchers.values())
    void dispatcher.then((agent) => agent.close()).catch(() => {});
  dispatchers.clear();
  health.clear();
  directHealth.clear();
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

function healthStore(
  route: UpstreamRoute,
  hostname: string,
): [Map<string, NodeHealth>, string] {
  return route.proxyUrl
    ? [health, route.id]
    : [directHealth, hostname.toLowerCase().replace(/\.$/, '')];
}

function isAvailable(
  route: UpstreamRoute,
  hostname: string,
  now: number,
): boolean {
  const [states, key] = healthStore(route, hostname);
  return (states.get(key)?.downUntil ?? 0) <= now;
}

// 有标识时按最高随机权重哈希固定出口：节点下线只让原本分到它的标识顺延
export function getUpstreamRoutes(
  hostname: string,
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
    .filter((route) => isAvailable(route, hostname, now))
    .slice(0, MAX_ROUTED_ATTEMPTS);
  if (
    !picked.includes(DIRECT_ROUTE) &&
    (isAvailable(DIRECT_ROUTE, hostname, now) || picked.length === 0)
  )
    picked.push(DIRECT_ROUTE);
  return picked;
}

function dispatcherFor(route: UpstreamRoute): Promise<Dispatcher> {
  const key = route.proxyUrl ?? DIRECT_ROUTE.id;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) {
    dispatcher = import('undici').then(({ Agent, ProxyAgent }) =>
      route.proxyUrl
        ? new ProxyAgent({
            uri: route.proxyUrl,
            proxyTls: { timeout: connectTimeoutMs() },
          })
        : new Agent({ connect: { timeout: connectTimeoutMs() } }),
    );
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

export async function fetchViaUpstreamRoute(
  route: UpstreamRoute,
  url: string,
  init: RequestInit,
  usePool = true,
): Promise<Response> {
  // 开发代理允许跳过本地 DNS 私网校验，direct 必须沿用其全局 dispatcher。
  if (
    !route.proxyUrl &&
    (!usePool || !isUpstreamProxyPoolConfigured() || isDevProxyActive())
  )
    return fetch(url, init);
  // 内置 fetch 的 undici 版本与依赖不同，池内出口统一用依赖自带的 fetch
  const [{ fetch: undiciFetch }, dispatcher] = await Promise.all([
    import('undici'),
    dispatcherFor(route),
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

// 建连阶段的失败说明请求尚未发出，带请求体的请求也可以安全换出口
const CONNECT_FAILURE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export function isUpstreamConnectFailure(error: unknown): boolean {
  if (!isUpstreamNetworkFailure(error)) return false;
  const code = ((error as TypeError).cause as { code?: unknown } | undefined)
    ?.code;
  return typeof code === 'string' && CONNECT_FAILURE_CODES.has(code);
}

export function reportUpstreamRouteSuccess(
  route: UpstreamRoute,
  hostname: string,
): void {
  if (!route.proxyUrl && !isUpstreamProxyPoolConfigured()) return;
  const [states, key] = healthStore(route, hostname);
  const state = states.get(key);
  if (!state) return;
  if (state.backoffMs > 0)
    console.info('Upstream route recovered', {
      node: route.id,
      ...(route.proxyUrl ? {} : { hostname: key }),
    });
  states.delete(key);
}

export function reportUpstreamRouteFailure(
  route: UpstreamRoute,
  hostname: string,
): void {
  if (!route.proxyUrl && !isUpstreamProxyPoolConfigured()) return;
  const [states, key] = healthStore(route, hostname);
  const now = Date.now();
  const state = states.get(key) ?? {
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
    console.warn('Upstream route down', {
      node: route.id,
      ...(route.proxyUrl ? {} : { hostname: key }),
      seconds: state.backoffMs / 1000,
    });
  }
  states.delete(key);
  states.set(key, state);
  // 目标主机基数由外部 URL 决定；保留最近失败记录，同时保留过期退避供翻倍使用。
  if (directHealth.size > MAX_DIRECT_HEALTH_ENTRIES) {
    const oldest = directHealth.keys().next().value;
    if (oldest !== undefined) directHealth.delete(oldest);
  }
}
