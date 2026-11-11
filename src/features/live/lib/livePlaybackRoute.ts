export type LivePlaybackRoute = 'browser' | 'server';

const SERVER_ROUTE_MEMORY_KEY = 'icetv:live-server-route-hosts';
const SERVER_ROUTE_MEMORY_TTL_MS = 30 * 60 * 1000;

function getStreamHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return '';
  }
}

// sessionStorage 不可用时靠进程内副本，否则回落后会再次判定为直连而反复切换
const inMemoryServerRoutes: Record<string, number> = {};

function readServerRouteMemory(now: number): Record<string, number> {
  let saved: Record<string, unknown> = {};
  if (typeof window !== 'undefined') {
    try {
      saved = JSON.parse(
        window.sessionStorage.getItem(SERVER_ROUTE_MEMORY_KEY) || '{}',
      );
    } catch {}
  }
  const active: Record<string, number> = {};
  for (const [host, until] of Object.entries({
    ...saved,
    ...inMemoryServerRoutes,
  })) {
    if (typeof until === 'number' && until > now) active[host] = until;
  }
  return active;
}

// 直连失败过的主机在本标签页内直接走服务器，避免每次换台都先失败一次
export function rememberLiveServerRoute(rawUrl: string, now = Date.now()) {
  const host = getStreamHost(rawUrl);
  if (!host) return;
  inMemoryServerRoutes[host] = now + SERVER_ROUTE_MEMORY_TTL_MS;
  if (typeof window === 'undefined') return;
  const memory = readServerRouteMemory(now);
  try {
    window.sessionStorage.setItem(
      SERVER_ROUTE_MEMORY_KEY,
      JSON.stringify(memory),
    );
  } catch {}
}

export function resolveInitialLiveRoute(
  rawUrl: string,
  now = Date.now(),
): LivePlaybackRoute {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'server';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'server';
  // https 页面上的 http 频道同样先直连：混合内容拦截在本地立即失败、随即回落，
  // 放行了不安全内容并装有跨域插件的用户可借此直连
  return readServerRouteMemory(now)[url.host] ? 'server' : 'browser';
}

// 走本站代理的请求失败不代表直连不可用
export function isDirectLiveRequestUrl(
  requestUrl: string | undefined,
  origin = typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost',
): boolean {
  if (!requestUrl) return false;
  try {
    const url = new URL(requestUrl, origin);
    return !(
      url.origin === new URL(origin).origin &&
      url.pathname.startsWith('/api/proxy/')
    );
  } catch {
    return false;
  }
}

const LIVE_PLAYLIST_CONTEXT_TYPES = new Set([
  'manifest',
  'level',
  'audioTrack',
  'subtitleTrack',
]);

export function isLivePlaylistContextType(type?: string): boolean {
  return !!type && LIVE_PLAYLIST_CONTEXT_TYPES.has(type);
}

export function buildLiveM3u8ProxyUrl({
  rawUrl,
  sourceKey,
  route,
}: {
  rawUrl: string;
  sourceKey: string;
  route: LivePlaybackRoute;
}): string {
  const params = new URLSearchParams({
    url: rawUrl,
    'icetv-live': '1',
  });
  if (sourceKey) {
    params.set('icetv-source', sourceKey);
  }
  if (route === 'browser') {
    params.set('allowCORS', 'true');
  } else {
    params.set('forceServer', 'true');
  }
  return `/api/proxy/m3u8?${params.toString()}`;
}

export function rewriteLivePlaylistRequestUrl(
  currentUrl: string,
  {
    sourceKey,
    route,
    origin = typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost',
  }: {
    sourceKey: string;
    route: LivePlaybackRoute;
    origin?: string;
  },
): string {
  try {
    const nextUrl = new URL(currentUrl, origin);
    if (!isM3u8ProxyUrl(nextUrl, origin)) {
      if (route === 'server') {
        return buildLiveM3u8ProxyUrl({
          rawUrl: nextUrl.toString(),
          sourceKey,
          route,
        });
      }
      return currentUrl;
    }

    nextUrl.searchParams.set('icetv-live', '1');
    if (sourceKey) {
      nextUrl.searchParams.set('icetv-source', sourceKey);
    }
    if (route === 'browser') {
      nextUrl.searchParams.set('allowCORS', 'true');
      nextUrl.searchParams.delete('forceServer');
    } else {
      nextUrl.searchParams.set('forceServer', 'true');
      nextUrl.searchParams.delete('allowCORS');
    }
    return nextUrl.toString();
  } catch {
    return appendLiveRouteQuery(currentUrl, sourceKey, route);
  }
}

function isM3u8ProxyUrl(url: URL, origin: string): boolean {
  try {
    if (url.origin !== new URL(origin).origin) {
      return false;
    }
  } catch {
    return false;
  }
  return /\/api\/proxy\/m3u8\/?$/i.test(url.pathname);
}

function appendLiveRouteQuery(
  currentUrl: string,
  sourceKey: string,
  route: LivePlaybackRoute,
): string {
  const params = new URLSearchParams({
    'icetv-live': '1',
  });
  if (sourceKey) {
    params.set('icetv-source', sourceKey);
  }
  if (route === 'browser') {
    params.set('allowCORS', 'true');
  } else {
    params.set('forceServer', 'true');
  }
  const separator = currentUrl.includes('?') ? '&' : '?';
  return `${currentUrl}${separator}${params.toString()}`;
}
