export type VodHlsBufferOverrides = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSize: number;
};

export type VodHlsLoadingOverrides = {
  manifestLoadingTimeOut: number;
  levelLoadingTimeOut: number;
};

const XIGUA_SEGMENT_PROXY_TIMEOUT_MS = 28_000;
const XIGUA_M3U8_PROXY_TIMEOUT_MS = 28_000;
const XIGUA_HLS_LOADING_TIMEOUT_MS = 30_000;
const XIGUA_PLAYER_LOADING_TIMEOUT_SECONDS = 35;

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
