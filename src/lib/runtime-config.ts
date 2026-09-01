import type { SourceCoverProxyMode } from '@/lib/source-cover-proxy';
import { CURRENT_UPDATE_BRANCH } from '@/lib/version';

export interface RuntimeConfig {
  STORAGE_TYPE: string;
  OPEN_REGISTER: boolean;
  REQUIRE_INVITE_CODE: boolean;
  UPDATE_REPOS: string;
  UPDATE_BRANCH: string;
  DOUBAN_PROXY_TYPE: string;
  DOUBAN_PROXY: string;
  BANGUMI_DATA_SOURCE: string;
  BANGUMI_PROXY: string;
  DOUBAN_IMAGE_PROXY_TYPE: string;
  DOUBAN_IMAGE_PROXY: string;
  DISABLE_YELLOW_FILTER: boolean;
  ENABLE_LIVE_ENTRY: boolean;
  DEFAULT_AGGREGATE_SEARCH: boolean;
  ENABLE_OPTIMIZATION: boolean;
  LIVE_DIRECT_CONNECT: boolean;
  ENABLE_DANMAKU: boolean;
  CUSTOM_CATEGORIES: { name: string; type: 'movie' | 'tv'; query: string }[];
  FLUID_SEARCH: boolean;
  VOD_PAGE_TIMEOUT_SECONDS: number;
  PLAYBACK_HISTORY_PAGE_SIZE: number;
  PLAYBACK_HISTORY_LIMIT: number;
  SEARCH_HISTORY_LIMIT: number;
  CONTINUE_WATCHING_LIMIT: number;
  COVER_IMAGE_CACHE_SIZE: number;
  SOURCE_COVER_PROXY_MODE: SourceCoverProxyMode;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  STORAGE_TYPE:
    process.env.NEXT_PUBLIC_STORAGE_TYPE === 'mysql' ? 'mysql' : 'localdb',
  OPEN_REGISTER: false,
  REQUIRE_INVITE_CODE: false,
  UPDATE_REPOS: 'naseaoi/IceTV',
  UPDATE_BRANCH: CURRENT_UPDATE_BRANCH,
  DOUBAN_PROXY_TYPE: 'direct',
  DOUBAN_PROXY: '',
  BANGUMI_DATA_SOURCE: 'direct',
  BANGUMI_PROXY: '',
  DOUBAN_IMAGE_PROXY_TYPE: 'direct',
  DOUBAN_IMAGE_PROXY: '',
  DISABLE_YELLOW_FILTER: false,
  ENABLE_LIVE_ENTRY: false,
  DEFAULT_AGGREGATE_SEARCH: true,
  ENABLE_OPTIMIZATION: true,
  LIVE_DIRECT_CONNECT: false,
  ENABLE_DANMAKU: false,
  CUSTOM_CATEGORIES: [],
  FLUID_SEARCH: true,
  VOD_PAGE_TIMEOUT_SECONDS: 15,
  PLAYBACK_HISTORY_PAGE_SIZE: 10,
  PLAYBACK_HISTORY_LIMIT: 500,
  SEARCH_HISTORY_LIMIT: 20,
  CONTINUE_WATCHING_LIMIT: 10,
  COVER_IMAGE_CACHE_SIZE: 500,
  SOURCE_COVER_PROXY_MODE: 'auto',
};

export function getCustomCategoryLabel(runtimeConfig?: RuntimeConfig): string {
  return (
    runtimeConfig?.CUSTOM_CATEGORIES.find((category) =>
      category.name.trim(),
    )?.name.trim() || '自定义'
  );
}

export type ServerConfigPayload = {
  SiteName?: string;
  SiteIcon?: string;
  Announcement?: string;
  FooterText?: string;
  StorageType?: string;
  OpenRegister?: boolean;
  RequireInviteCode?: boolean;
  UpdateRepos?: string;
  UpdateBranch?: string;
  DoubanProxyType?: string;
  DoubanProxy?: string;
  BangumiDataSource?: string;
  BangumiProxy?: string;
  DoubanImageProxyType?: string;
  DoubanImageProxy?: string;
  DisableYellowFilter?: boolean;
  EnableLiveEntry?: boolean;
  DefaultAggregateSearch?: boolean;
  EnableOptimization?: boolean;
  LiveDirectConnect?: boolean;
  EnableDanmaku?: boolean;
  CustomCategories?: RuntimeConfig['CUSTOM_CATEGORIES'];
  FluidSearch?: boolean;
  VodPageTimeoutSeconds?: number;
  PlaybackHistoryPageSize?: number;
  PlaybackHistoryLimit?: number;
  SearchHistoryLimit?: number;
  ContinueWatchingLimit?: number;
  CoverImageCacheSize?: number;
  SourceCoverProxyMode?: SourceCoverProxyMode;
};

declare global {
  interface Window {
    RUNTIME_CONFIG?: RuntimeConfig;
    __runtimeConfigReady?: boolean;
    __sidebarCollapsed?: boolean;
  }
}

export function getRuntimeConfig(): RuntimeConfig | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.RUNTIME_CONFIG;
}

function runtimeConfigFromServerConfig(
  data: ServerConfigPayload,
): RuntimeConfig {
  return {
    STORAGE_TYPE: data.StorageType || DEFAULT_RUNTIME_CONFIG.STORAGE_TYPE,
    OPEN_REGISTER:
      data.OpenRegister === undefined
        ? DEFAULT_RUNTIME_CONFIG.OPEN_REGISTER
        : data.OpenRegister,
    REQUIRE_INVITE_CODE:
      data.RequireInviteCode === undefined
        ? DEFAULT_RUNTIME_CONFIG.REQUIRE_INVITE_CODE
        : data.RequireInviteCode,
    UPDATE_REPOS: data.UpdateRepos || DEFAULT_RUNTIME_CONFIG.UPDATE_REPOS,
    UPDATE_BRANCH: data.UpdateBranch || DEFAULT_RUNTIME_CONFIG.UPDATE_BRANCH,
    DOUBAN_PROXY_TYPE:
      data.DoubanProxyType || DEFAULT_RUNTIME_CONFIG.DOUBAN_PROXY_TYPE,
    DOUBAN_PROXY: data.DoubanProxy || DEFAULT_RUNTIME_CONFIG.DOUBAN_PROXY,
    BANGUMI_DATA_SOURCE:
      data.BangumiDataSource || DEFAULT_RUNTIME_CONFIG.BANGUMI_DATA_SOURCE,
    BANGUMI_PROXY: data.BangumiProxy || DEFAULT_RUNTIME_CONFIG.BANGUMI_PROXY,
    DOUBAN_IMAGE_PROXY_TYPE:
      data.DoubanImageProxyType ||
      DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY_TYPE,
    DOUBAN_IMAGE_PROXY:
      data.DoubanImageProxy || DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY,
    DISABLE_YELLOW_FILTER:
      data.DisableYellowFilter === undefined
        ? DEFAULT_RUNTIME_CONFIG.DISABLE_YELLOW_FILTER
        : data.DisableYellowFilter,
    ENABLE_LIVE_ENTRY:
      data.EnableLiveEntry === undefined
        ? DEFAULT_RUNTIME_CONFIG.ENABLE_LIVE_ENTRY
        : data.EnableLiveEntry,
    DEFAULT_AGGREGATE_SEARCH:
      data.DefaultAggregateSearch === undefined
        ? DEFAULT_RUNTIME_CONFIG.DEFAULT_AGGREGATE_SEARCH
        : data.DefaultAggregateSearch,
    ENABLE_OPTIMIZATION:
      data.EnableOptimization === undefined
        ? DEFAULT_RUNTIME_CONFIG.ENABLE_OPTIMIZATION
        : data.EnableOptimization,
    LIVE_DIRECT_CONNECT:
      data.LiveDirectConnect === undefined
        ? DEFAULT_RUNTIME_CONFIG.LIVE_DIRECT_CONNECT
        : data.LiveDirectConnect,
    ENABLE_DANMAKU:
      data.EnableDanmaku === undefined
        ? DEFAULT_RUNTIME_CONFIG.ENABLE_DANMAKU
        : data.EnableDanmaku,
    CUSTOM_CATEGORIES:
      data.CustomCategories || DEFAULT_RUNTIME_CONFIG.CUSTOM_CATEGORIES,
    FLUID_SEARCH:
      data.FluidSearch === undefined
        ? DEFAULT_RUNTIME_CONFIG.FLUID_SEARCH
        : data.FluidSearch,
    VOD_PAGE_TIMEOUT_SECONDS:
      data.VodPageTimeoutSeconds ??
      DEFAULT_RUNTIME_CONFIG.VOD_PAGE_TIMEOUT_SECONDS,
    PLAYBACK_HISTORY_PAGE_SIZE:
      data.PlaybackHistoryPageSize ??
      DEFAULT_RUNTIME_CONFIG.PLAYBACK_HISTORY_PAGE_SIZE,
    PLAYBACK_HISTORY_LIMIT:
      data.PlaybackHistoryLimit ??
      DEFAULT_RUNTIME_CONFIG.PLAYBACK_HISTORY_LIMIT,
    SEARCH_HISTORY_LIMIT:
      data.SearchHistoryLimit ?? DEFAULT_RUNTIME_CONFIG.SEARCH_HISTORY_LIMIT,
    CONTINUE_WATCHING_LIMIT:
      data.ContinueWatchingLimit ??
      DEFAULT_RUNTIME_CONFIG.CONTINUE_WATCHING_LIMIT,
    COVER_IMAGE_CACHE_SIZE:
      data.CoverImageCacheSize ?? DEFAULT_RUNTIME_CONFIG.COVER_IMAGE_CACHE_SIZE,
    SOURCE_COVER_PROXY_MODE:
      data.SourceCoverProxyMode ??
      DEFAULT_RUNTIME_CONFIG.SOURCE_COVER_PROXY_MODE,
  };
}

let serverConfigRequest: Promise<ServerConfigPayload> | null = null;

export async function fetchClientServerConfig(): Promise<ServerConfigPayload> {
  if (!serverConfigRequest) {
    serverConfigRequest = fetch('/api/server-config', {
      method: 'GET',
      cache: 'no-cache',
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`server-config: ${response.status}`);
        }
        return response.json() as Promise<ServerConfigPayload>;
      })
      .finally(() => {
        serverConfigRequest = null;
      });
  }

  return serverConfigRequest;
}

export function applyClientServerConfig(
  data: ServerConfigPayload,
): RuntimeConfig {
  const nextConfig = runtimeConfigFromServerConfig(data);

  if (typeof window !== 'undefined') {
    window.RUNTIME_CONFIG = nextConfig;
    window.__runtimeConfigReady = true;
    window.dispatchEvent(
      new CustomEvent('runtime-config-updated', { detail: nextConfig }),
    );
  }

  return nextConfig;
}

async function refreshClientRuntimeConfig(): Promise<RuntimeConfig> {
  const data = await fetchClientServerConfig();
  return applyClientServerConfig(data);
}

async function ensureClientRuntimeConfig(): Promise<RuntimeConfig> {
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig && window.__runtimeConfigReady) {
    return runtimeConfig;
  }

  try {
    return await refreshClientRuntimeConfig();
  } catch {
    if (typeof window !== 'undefined') {
      window.RUNTIME_CONFIG = DEFAULT_RUNTIME_CONFIG;
      window.__runtimeConfigReady = true;
    }
    return DEFAULT_RUNTIME_CONFIG;
  }
}

export async function getClientAuthRuntimeConfig(): Promise<{
  storageType: string;
  openRegister: boolean;
  requireInviteCode: boolean;
}> {
  const runtimeConfig = await ensureClientRuntimeConfig();
  return {
    storageType: runtimeConfig.STORAGE_TYPE,
    openRegister: runtimeConfig.OPEN_REGISTER,
    requireInviteCode: runtimeConfig.REQUIRE_INVITE_CODE,
  };
}
