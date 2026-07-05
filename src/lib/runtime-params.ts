import type { AdminConfig } from '@/types/admin';

export type RuntimeParamSettings = Pick<
  AdminConfig['SiteConfig'],
  | 'SearchDownstreamMaxPage'
  | 'SiteInterfaceCacheTime'
  | 'VodPageTimeoutSeconds'
  | 'PlaybackHistoryPageSize'
  | 'PlaybackHistoryLimit'
  | 'SearchHistoryLimit'
  | 'SearchRequestTimeoutSeconds'
  | 'SourceFailureCooldownSeconds'
  | 'ContinueWatchingLimit'
  | 'CoverImageCacheSize'
  | 'DataImportPlaybackSessionsLimit'
  | 'LivePrecheckTimeoutSeconds'
  | 'ProxyRequestTimeoutSeconds'
>;

export const DEFAULT_RUNTIME_PARAMS: RuntimeParamSettings = {
  SearchDownstreamMaxPage: Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
  SiteInterfaceCacheTime: 7200,
  VodPageTimeoutSeconds: 15,
  PlaybackHistoryPageSize: 10,
  PlaybackHistoryLimit: 500,
  SearchHistoryLimit: 20,
  SearchRequestTimeoutSeconds: 8,
  SourceFailureCooldownSeconds: 300,
  ContinueWatchingLimit: 10,
  CoverImageCacheSize: 500,
  DataImportPlaybackSessionsLimit: 500,
  LivePrecheckTimeoutSeconds: 15,
  ProxyRequestTimeoutSeconds: 15,
};

export const RUNTIME_PARAM_RANGES: Record<
  keyof RuntimeParamSettings,
  { min: number; max: number }
> = {
  SearchDownstreamMaxPage: { min: 1, max: 20 },
  SiteInterfaceCacheTime: { min: 1, max: 86400 },
  VodPageTimeoutSeconds: { min: 5, max: 120 },
  PlaybackHistoryPageSize: { min: 1, max: 100 },
  PlaybackHistoryLimit: { min: 1, max: 10000 },
  SearchHistoryLimit: { min: 1, max: 200 },
  SearchRequestTimeoutSeconds: { min: 1, max: 60 },
  SourceFailureCooldownSeconds: { min: 0, max: 3600 },
  ContinueWatchingLimit: { min: 1, max: 100 },
  CoverImageCacheSize: { min: 50, max: 5000 },
  DataImportPlaybackSessionsLimit: { min: 1, max: 20000 },
  LivePrecheckTimeoutSeconds: { min: 1, max: 60 },
  ProxyRequestTimeoutSeconds: { min: 1, max: 120 },
};

export function normalizeRuntimeParam<K extends keyof RuntimeParamSettings>(
  key: K,
  value: unknown,
): RuntimeParamSettings[K] {
  const fallback = DEFAULT_RUNTIME_PARAMS[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  const range = RUNTIME_PARAM_RANGES[key];
  const nextValue = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.min(
    Math.max(nextValue, range.min),
    range.max,
  ) as RuntimeParamSettings[K];
}

export function normalizeRuntimeParams(
  value: Partial<RuntimeParamSettings>,
): RuntimeParamSettings {
  return {
    SearchDownstreamMaxPage: normalizeRuntimeParam(
      'SearchDownstreamMaxPage',
      value.SearchDownstreamMaxPage,
    ),
    SiteInterfaceCacheTime: normalizeRuntimeParam(
      'SiteInterfaceCacheTime',
      value.SiteInterfaceCacheTime,
    ),
    VodPageTimeoutSeconds: normalizeRuntimeParam(
      'VodPageTimeoutSeconds',
      value.VodPageTimeoutSeconds,
    ),
    PlaybackHistoryPageSize: normalizeRuntimeParam(
      'PlaybackHistoryPageSize',
      value.PlaybackHistoryPageSize,
    ),
    PlaybackHistoryLimit: normalizeRuntimeParam(
      'PlaybackHistoryLimit',
      value.PlaybackHistoryLimit,
    ),
    SearchHistoryLimit: normalizeRuntimeParam(
      'SearchHistoryLimit',
      value.SearchHistoryLimit,
    ),
    SearchRequestTimeoutSeconds: normalizeRuntimeParam(
      'SearchRequestTimeoutSeconds',
      value.SearchRequestTimeoutSeconds,
    ),
    SourceFailureCooldownSeconds: normalizeRuntimeParam(
      'SourceFailureCooldownSeconds',
      value.SourceFailureCooldownSeconds,
    ),
    ContinueWatchingLimit: normalizeRuntimeParam(
      'ContinueWatchingLimit',
      value.ContinueWatchingLimit,
    ),
    CoverImageCacheSize: normalizeRuntimeParam(
      'CoverImageCacheSize',
      value.CoverImageCacheSize,
    ),
    DataImportPlaybackSessionsLimit: normalizeRuntimeParam(
      'DataImportPlaybackSessionsLimit',
      value.DataImportPlaybackSessionsLimit,
    ),
    LivePrecheckTimeoutSeconds: normalizeRuntimeParam(
      'LivePrecheckTimeoutSeconds',
      value.LivePrecheckTimeoutSeconds,
    ),
    ProxyRequestTimeoutSeconds: normalizeRuntimeParam(
      'ProxyRequestTimeoutSeconds',
      value.ProxyRequestTimeoutSeconds,
    ),
  };
}

export function runtimeParamsFromConfig(
  config: Pick<AdminConfig, 'SiteConfig'>,
): RuntimeParamSettings {
  return normalizeRuntimeParams(config.SiteConfig);
}
