import { CURRENT_UPDATE_BRANCH } from '@/lib/version';

export interface RuntimeConfig {
  STORAGE_TYPE: string;
  OPEN_REGISTER: boolean;
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
  AUTO_SWITCH_SOURCE_ON_TIMEOUT: boolean;
  LIVE_DIRECT_CONNECT: boolean;
  CUSTOM_CATEGORIES: { name: string; type: 'movie' | 'tv'; query: string }[];
  FLUID_SEARCH: boolean;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  STORAGE_TYPE:
    process.env.NEXT_PUBLIC_STORAGE_TYPE === 'mysql' ? 'mysql' : 'localdb',
  OPEN_REGISTER: false,
  UPDATE_REPOS: 'naseaoi/IceTV',
  UPDATE_BRANCH: CURRENT_UPDATE_BRANCH,
  DOUBAN_PROXY_TYPE: 'direct',
  DOUBAN_PROXY: '',
  BANGUMI_DATA_SOURCE: 'server',
  BANGUMI_PROXY: '',
  DOUBAN_IMAGE_PROXY_TYPE: 'cmliussss-cdn-tencent',
  DOUBAN_IMAGE_PROXY: '',
  DISABLE_YELLOW_FILTER: false,
  ENABLE_LIVE_ENTRY: false,
  DEFAULT_AGGREGATE_SEARCH: true,
  ENABLE_OPTIMIZATION: true,
  AUTO_SWITCH_SOURCE_ON_TIMEOUT: false,
  LIVE_DIRECT_CONNECT: false,
  CUSTOM_CATEGORIES: [],
  FLUID_SEARCH: true,
};

export type ServerConfigPayload = {
  SiteName?: string;
  SiteIcon?: string;
  Announcement?: string;
  StorageType?: string;
  OpenRegister?: boolean;
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
  AutoSwitchSourceOnTimeout?: boolean;
  LiveDirectConnect?: boolean;
  CustomCategories?: RuntimeConfig['CUSTOM_CATEGORIES'];
  FluidSearch?: boolean;
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
    AUTO_SWITCH_SOURCE_ON_TIMEOUT:
      data.AutoSwitchSourceOnTimeout === undefined
        ? DEFAULT_RUNTIME_CONFIG.AUTO_SWITCH_SOURCE_ON_TIMEOUT
        : data.AutoSwitchSourceOnTimeout,
    LIVE_DIRECT_CONNECT:
      data.LiveDirectConnect === undefined
        ? DEFAULT_RUNTIME_CONFIG.LIVE_DIRECT_CONNECT
        : data.LiveDirectConnect,
    CUSTOM_CATEGORIES:
      data.CustomCategories || DEFAULT_RUNTIME_CONFIG.CUSTOM_CATEGORIES,
    FLUID_SEARCH:
      data.FluidSearch === undefined
        ? DEFAULT_RUNTIME_CONFIG.FLUID_SEARCH
        : data.FluidSearch,
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
}> {
  const runtimeConfig = await ensureClientRuntimeConfig();
  return {
    storageType: runtimeConfig.STORAGE_TYPE,
    openRegister: runtimeConfig.OPEN_REGISTER,
  };
}
