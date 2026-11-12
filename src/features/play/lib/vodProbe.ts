import { getVideoResolutionFromM3u8 } from '@/features/play/lib/hls-utils';
import { resolveLazyEpisodeUrl } from '@/features/play/lib/lazyEpisode';
import { throwIfPlaybackCancelled } from '@/features/play/lib/sharedPlaybackTask';
import { fetchSourceProbe } from '@/features/play/lib/sourceProbeRequest';
import {
  isSourceProbeNetworkError,
  readSourceProbeBody,
  SourceProbeDeferredError,
  SourceProbeNetworkError,
} from '@/features/play/lib/sourceProbeRequestPolicy';
import {
  buildVodSegmentProxyUrl,
  isVodM3u8Url,
  isVodMp4Url,
} from '@/features/play/lib/vodProxyUrl';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import { formatBytesPerSecond } from '@/lib/player-utils';
import {
  type SourcePlaybackRoute,
  clearSourceProxyOverride,
  getSourcePlaybackRoute,
  rememberSourceServerProxy,
} from '@/lib/proxy-modes';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';

export type VodProbeResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
};

const MP4_PROBE_TIMEOUT_MS = 8_000;
const MP4_PROBE_MAX_BYTES = 256 * 1024;
const MP4_PROBE_MIN_SPEED_BYTES = 32 * 1024;

function buildMp4ProbeUrl(
  rawUrl: string,
  useProxy: boolean,
  sourceKey: string,
) {
  if (!useProxy) {
    return rawUrl;
  }

  return buildVodSegmentProxyUrl({
    rawUrl,
    sourceKey,
    playbackRequestMode: 'initial',
  });
}

async function readProbeBytes(response: Response): Promise<{
  bytes: number;
  firstByteAt: number;
}> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await readSourceProbeBody(() => response.arrayBuffer());
    return {
      bytes: Math.min(buffer.byteLength, MP4_PROBE_MAX_BYTES),
      firstByteAt: performance.now(),
    };
  }

  let bytes = 0;
  let firstByteAt = 0;
  while (bytes < MP4_PROBE_MAX_BYTES) {
    const { done, value } = await readSourceProbeBody(() => reader.read());
    if (done) break;
    if (!value) continue;

    if (firstByteAt === 0) {
      firstByteAt = performance.now();
    }
    bytes += value.byteLength;
  }

  try {
    await reader.cancel();
  } catch {}

  return { bytes, firstByteAt };
}

async function probeMp4WithMode(
  rawUrl: string,
  useProxy: boolean,
  sourceKey: string,
  signal?: AbortSignal,
): Promise<VodProbeResult> {
  throwIfPlaybackCancelled(signal);
  const url = buildMp4ProbeUrl(rawUrl, useProxy, sourceKey);
  const abortState = createTimedAbortController(signal, MP4_PROBE_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetchSourceProbe(url, {
      cache: 'no-store',
      headers: { Range: `bytes=0-${MP4_PROBE_MAX_BYTES - 1}` },
      signal: abortState.signal,
    });
    if (!response.ok && response.status !== 206) {
      throw new SourceProbeNetworkError(
        `Failed to load mp4 sample: ${response.status}`,
      );
    }

    const { bytes, firstByteAt } = await readProbeBytes(response);
    const pingTime = Math.round(performance.now() - startedAt);
    const elapsedMs = firstByteAt > 0 ? performance.now() - firstByteAt : 0;
    const loadSpeed =
      bytes >= MP4_PROBE_MIN_SPEED_BYTES && elapsedMs > 0
        ? formatBytesPerSecond(bytes / (elapsedMs / 1000))
        : '未知';

    return {
      quality: 'MP4',
      loadSpeed,
      pingTime,
    };
  } catch (error) {
    throwIfPlaybackCancelled(signal);
    if ((error as Error)?.name === 'AbortError') {
      throw new SourceProbeNetworkError('Timeout loading mp4 sample');
    }
    throw error instanceof Error
      ? error
      : new Error('Failed to probe mp4 sample');
  } finally {
    abortState.cleanup();
  }
}

async function probeMp4(
  rawUrl: string,
  route: SourcePlaybackRoute,
  sourceKey: string,
  signal?: AbortSignal,
): Promise<VodProbeResult> {
  const useProxy = route.useServerProxy;
  try {
    const result = await probeMp4WithMode(rawUrl, useProxy, sourceKey, signal);
    throwIfPlaybackCancelled(signal);
    reportSourceRouteStat(sourceKey, useProxy ? 'server' : 'browser', true);
    if (!useProxy && sourceKey) {
      clearSourceProxyOverride(sourceKey, rawUrl);
    }
    return result;
  } catch (error) {
    throwIfPlaybackCancelled(signal);
    if (isSourceProbeNetworkError(error))
      reportSourceRouteStat(sourceKey, useProxy ? 'server' : 'browser', false);
    if (
      error instanceof SourceProbeDeferredError ||
      !isSourceProbeNetworkError(error) ||
      !sourceKey ||
      !route.allowAutoFallback
    ) {
      throw error;
    }

    try {
      const result = await probeMp4WithMode(
        rawUrl,
        !useProxy,
        sourceKey,
        signal,
      );
      throwIfPlaybackCancelled(signal);
      reportSourceRouteStat(sourceKey, useProxy ? 'browser' : 'server', true);
      if (useProxy) clearSourceProxyOverride(sourceKey, rawUrl);
      else rememberSourceServerProxy(sourceKey, rawUrl);
      return result;
    } catch (fallbackError) {
      throwIfPlaybackCancelled(signal);
      if (isSourceProbeNetworkError(fallbackError))
        reportSourceRouteStat(
          sourceKey,
          useProxy ? 'browser' : 'server',
          false,
        );
      throw fallbackError;
    }
  }
}

export async function probeVodEpisodeUrl(
  rawUrl: string,
  route: SourcePlaybackRoute,
  sourceKey: string,
  signal?: AbortSignal,
): Promise<VodProbeResult> {
  throwIfPlaybackCancelled(signal);
  const targetUrl = isLazyEpisodeUrl(rawUrl)
    ? await resolveLazyEpisodeUrl(sourceKey, rawUrl, { probe: true, signal })
    : rawUrl;

  throwIfPlaybackCancelled(signal);
  if (targetUrl !== rawUrl)
    route = getSourcePlaybackRoute(sourceKey, targetUrl);

  if (isVodM3u8Url(targetUrl)) {
    return getVideoResolutionFromM3u8(targetUrl, route, sourceKey, signal);
  }

  if (isVodMp4Url(targetUrl)) {
    return probeMp4(targetUrl, route, sourceKey, signal);
  }

  throw new Error('Unsupported vod url for probe');
}
