export type LivePlaybackRoute = 'browser' | 'server';

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
