import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';

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
