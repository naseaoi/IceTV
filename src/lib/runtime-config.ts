/**
 * 全局 RUNTIME_CONFIG 类型定义与类型安全访问器。
 * layout.tsx 在服务端将配置序列化后通过 <script> 注入到 window.RUNTIME_CONFIG。
 */

export interface RuntimeConfig {
  STORAGE_TYPE: string;
  OPEN_REGISTER: boolean;
  UPDATE_REPOS: string;
  UPDATE_BRANCH: string;
  DOUBAN_PROXY_TYPE: string;
  DOUBAN_PROXY: string;
  DOUBAN_IMAGE_PROXY_TYPE: string;
  DOUBAN_IMAGE_PROXY: string;
  DISABLE_YELLOW_FILTER: boolean;
  ENABLE_LIVE_ENTRY: boolean;
  CUSTOM_CATEGORIES: { name: string; type: 'movie' | 'tv'; query: string }[];
  FLUID_SEARCH: boolean;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  STORAGE_TYPE:
    process.env.NEXT_PUBLIC_STORAGE_TYPE === 'mysql' ? 'mysql' : 'localdb',
  OPEN_REGISTER: false,
  UPDATE_REPOS: 'naseaoi/IceTV',
  UPDATE_BRANCH: 'main',
  DOUBAN_PROXY_TYPE: 'direct',
  DOUBAN_PROXY: '',
  DOUBAN_IMAGE_PROXY_TYPE: 'direct',
  DOUBAN_IMAGE_PROXY: '',
  DISABLE_YELLOW_FILTER: false,
  ENABLE_LIVE_ENTRY: false,
  CUSTOM_CATEGORIES: [],
  FLUID_SEARCH: true,
};

declare global {
  interface Window {
    RUNTIME_CONFIG?: RuntimeConfig;
    __sidebarCollapsed?: boolean;
  }
}

/** 获取运行时配置（仅客户端可用）。服务端调用时返回 undefined。 */
export function getRuntimeConfig(): RuntimeConfig | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.RUNTIME_CONFIG;
}

type ServerConfigFallback = {
  StorageType?: string;
  OpenRegister?: boolean;
  UpdateRepos?: string;
  UpdateBranch?: string;
  DoubanProxyType?: string;
  DoubanProxy?: string;
  DoubanImageProxyType?: string;
  DoubanImageProxy?: string;
  DisableYellowFilter?: boolean;
  EnableLiveEntry?: boolean;
  CustomCategories?: RuntimeConfig['CUSTOM_CATEGORIES'];
  FluidSearch?: boolean;
};

export async function ensureClientRuntimeConfig(): Promise<RuntimeConfig> {
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig) {
    return runtimeConfig;
  }

  try {
    const response = await fetch('/api/server-config', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`server-config: ${response.status}`);
    }

    const data = (await response.json()) as ServerConfigFallback;
    const nextConfig: RuntimeConfig = {
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
      CUSTOM_CATEGORIES:
        data.CustomCategories || DEFAULT_RUNTIME_CONFIG.CUSTOM_CATEGORIES,
      FLUID_SEARCH:
        data.FluidSearch === undefined
          ? DEFAULT_RUNTIME_CONFIG.FLUID_SEARCH
          : data.FluidSearch,
    };

    if (typeof window !== 'undefined') {
      window.RUNTIME_CONFIG = nextConfig;
    }

    return nextConfig;
  } catch {
    if (typeof window !== 'undefined') {
      window.RUNTIME_CONFIG = DEFAULT_RUNTIME_CONFIG;
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
