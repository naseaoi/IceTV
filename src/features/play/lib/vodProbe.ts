import { getVideoResolutionFromM3u8 } from '@/features/play/lib/hls-utils';
import { formatBytesPerSecond } from '@/lib/player-utils';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import {
  clearSourceProxyOverride,
  rememberSourceServerProxy,
  shouldAutoFallbackToServer,
} from '@/lib/proxy-modes';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';

import { resolveLazyEpisodeUrl } from '@/features/play/lib/lazyEpisode';

import {
  buildVodSegmentProxyUrl,
  isVodM3u8Url,
  isVodMp4Url,
} from '@/features/play/lib/vodProxyUrl';

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
    const buffer = await response.arrayBuffer();
    return {
      bytes: Math.min(buffer.byteLength, MP4_PROBE_MAX_BYTES),
      firstByteAt: performance.now(),
    };
  }

  let bytes = 0;
  let firstByteAt = 0;
  while (bytes < MP4_PROBE_MAX_BYTES) {
    const { done, value } = await reader.read();
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
): Promise<VodProbeResult> {
  const url = buildMp4ProbeUrl(rawUrl, useProxy, sourceKey);
  const abortState = createTimedAbortController(
    undefined,
    MP4_PROBE_TIMEOUT_MS,
  );
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Range: `bytes=0-${MP4_PROBE_MAX_BYTES - 1}` },
      signal: abortState.signal,
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to load mp4 sample: ${response.status}`);
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
    if ((error as Error)?.name === 'AbortError') {
      throw new Error('Timeout loading mp4 sample');
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
  useProxy: boolean,
  sourceKey: string,
): Promise<VodProbeResult> {
  try {
    const result = await probeMp4WithMode(rawUrl, useProxy, sourceKey);
    if (!useProxy && sourceKey) {
      clearSourceProxyOverride(sourceKey, rawUrl);
    }
    return result;
  } catch (error) {
    if (useProxy || !sourceKey || !shouldAutoFallbackToServer(sourceKey)) {
      throw error;
    }

    const result = await probeMp4WithMode(rawUrl, true, sourceKey);
    if (sourceKey) {
      rememberSourceServerProxy(sourceKey, rawUrl);
    }
    return result;
  }
}

export async function probeVodEpisodeUrl(
  rawUrl: string,
  useProxy: boolean,
  sourceKey: string,
): Promise<VodProbeResult> {
  const targetUrl = isLazyEpisodeUrl(rawUrl)
    ? await resolveLazyEpisodeUrl(sourceKey, rawUrl)
    : rawUrl;

  if (isVodM3u8Url(targetUrl)) {
    return getVideoResolutionFromM3u8(targetUrl, useProxy, sourceKey);
  }

  if (isVodMp4Url(targetUrl)) {
    return probeMp4(targetUrl, useProxy, sourceKey);
  }

  throw new Error('Unsupported vod url for probe');
}
