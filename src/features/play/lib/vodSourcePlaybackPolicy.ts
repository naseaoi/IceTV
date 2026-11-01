import { resolveVodFragmentTimeoutMs } from '@/features/play/lib/vodAutoRoutePolicy';
import { normalizeRuntimeParam } from '@/lib/runtime-params';

export const VOD_STARTUP_PROGRESS_POLL_MS = 250;
const VOD_STARTUP_TOTAL_WINDOW_MULTIPLIER = 4;

export function resolveVodStartupTimeouts(
  sourceKey: string,
  configuredPageSeconds: unknown,
  configuredFragmentSeconds: unknown,
): { idleMs: number; totalMs: number } {
  const idleMs = Math.max(
    resolveVodPlayerLoadingTimeoutSeconds(
      sourceKey,
      normalizeRuntimeParam('VodPageTimeoutSeconds', configuredPageSeconds),
    ) * 1000,
    resolveVodSourceFragmentTimeoutMs(
      sourceKey,
      resolveVodFragmentTimeoutMs(configuredFragmentSeconds),
    ),
  );
  return { idleMs, totalMs: idleMs * VOD_STARTUP_TOTAL_WINDOW_MULTIPLIER };
}

export type VodHlsBufferOverrides = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSize: number;
};

export type VodHlsLoadingOverrides = {
  manifestLoadingTimeOut: number;
  levelLoadingTimeOut: number;
};

export type VodSegmentPrebufferPolicy = {
  concurrency: number;
  durationSeconds: number;
  height: number;
  lookaheadSeconds: number;
  maxFragments: number;
  segmentHostname: string;
};

const XIGUA_SEGMENT_PROXY_TIMEOUT_MS = 28_000;
const XIGUA_M3U8_PROXY_TIMEOUT_MS = 28_000;
const XIGUA_HLS_LOADING_TIMEOUT_MS = 30_000;
const XIGUA_PLAYER_LOADING_TIMEOUT_SECONDS = 35;

const VOD_SEGMENT_PREBUFFER_POLICIES: Readonly<
  Record<string, VodSegmentPrebufferPolicy>
> = {
  xigua: {
    concurrency: 4,
    durationSeconds: 70,
    height: 720,
    lookaheadSeconds: 12,
    maxFragments: 18,
    segmentHostname: 'xgct-video.bzcdn.net',
  },
};

export function getVodHlsBufferOverrides(
  sourceKey: string,
): Partial<VodHlsBufferOverrides> {
  if (sourceKey !== 'xigua') {
    return {};
  }

  return {
    maxBufferLength: 120,
    maxMaxBufferLength: 300,
    maxBufferSize: 60 * 1000 * 1000,
  };
}

export function getVodHlsLoadingOverrides(
  sourceKey: string,
): Partial<VodHlsLoadingOverrides> {
  if (sourceKey !== 'xigua') {
    return {};
  }
  return {
    manifestLoadingTimeOut: XIGUA_HLS_LOADING_TIMEOUT_MS,
    levelLoadingTimeOut: XIGUA_HLS_LOADING_TIMEOUT_MS,
  };
}

export function resolveVodSegmentPrebufferPolicy(
  sourceKey: string,
): Readonly<VodSegmentPrebufferPolicy> | null {
  return VOD_SEGMENT_PREBUFFER_POLICIES[sourceKey] ?? null;
}

export function resolveVodSegmentProxyTimeoutMs(
  sourceKey: string | null,
  configuredTimeoutMs: number,
): number {
  if (sourceKey !== 'xigua') {
    return configuredTimeoutMs;
  }
  return Math.max(configuredTimeoutMs, XIGUA_SEGMENT_PROXY_TIMEOUT_MS);
}

export function resolveVodM3U8ProxyTimeoutMs(
  sourceKey: string | null,
  configuredTimeoutMs: number,
): number {
  if (sourceKey !== 'xigua') {
    return configuredTimeoutMs;
  }
  return Math.max(configuredTimeoutMs, XIGUA_M3U8_PROXY_TIMEOUT_MS);
}

export function resolveVodSourceFragmentTimeoutMs(
  sourceKey: string | null | undefined,
  configuredTimeoutMs: number,
): number {
  if (sourceKey !== 'xigua') {
    return configuredTimeoutMs;
  }
  return Math.max(configuredTimeoutMs, XIGUA_HLS_LOADING_TIMEOUT_MS);
}

export function resolveVodPlayerLoadingTimeoutSeconds(
  sourceKey: string,
  configuredTimeoutSeconds: number,
): number {
  if (sourceKey !== 'xigua') {
    return configuredTimeoutSeconds;
  }
  return Math.max(
    configuredTimeoutSeconds,
    XIGUA_PLAYER_LOADING_TIMEOUT_SECONDS,
  );
}
