import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';

function pathMatchesExtension(rawUrl: string, extension: string): boolean {
  try {
    return new URL(rawUrl).pathname.toLowerCase().endsWith(extension);
  } catch {
    return new RegExp(`\\${extension}(?:$|[?#])`, 'i').test(rawUrl);
  }
}

export function isVodM3u8Url(rawUrl: string): boolean {
  return pathMatchesExtension(rawUrl, '.m3u8');
}

export function isVodMp4Url(rawUrl: string): boolean {
  return pathMatchesExtension(rawUrl, '.mp4');
}

export function appendVodPlaybackRequestContext(
  params: URLSearchParams,
  mode: PlaybackRequestMode,
): void {
  params.set('icetv-switch', mode);
  params.set('icetv-user-switch', mode === 'manual-source' ? '1' : '0');
}

export function buildVodProxyUrl({
  rawUrl,
  useServerProxy,
  sourceKey,
  playbackRequestMode,
}: {
  rawUrl: string;
  useServerProxy: boolean;
  sourceKey: string;
  playbackRequestMode: PlaybackRequestMode;
}): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (useServerProxy) {
    params.set('forceServer', 'true');
  } else {
    params.set('allowCORS', 'true');
  }
  if (sourceKey) {
    params.set('icetv-source', sourceKey);
  }
  appendVodPlaybackRequestContext(params, playbackRequestMode);
  return `/api/proxy/m3u8?${params.toString()}`;
}

export function buildVodSegmentProxyUrl({
  rawUrl,
  sourceKey,
  playbackRequestMode,
}: {
  rawUrl: string;
  sourceKey: string;
  playbackRequestMode: PlaybackRequestMode;
}): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (sourceKey) {
    params.set('icetv-source', sourceKey);
  }
  appendVodPlaybackRequestContext(params, playbackRequestMode);
  return `/api/proxy/segment?${params.toString()}`;
}
