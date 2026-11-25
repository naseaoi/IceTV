import { clearSearchSnapshotCache } from '@/features/search/lib/searchSnapshotCache';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DEFAULT_DOUBAN_PROXY_TYPE,
} from '@/lib/douban-source';
import type { SourceCoverProxyMode } from '@/lib/source-cover-proxy';
import { CURRENT_UPDATE_BRANCH } from '@/lib/version';

export interface RuntimeConfig {
  STORAGE_TYPE: string;
  PASSWORD_REGISTER: boolean;
  LINUXDO_LOGIN: boolean;
  REQUIRE_INVITE_CODE: boolean;
  UPDATE_REPOS: string;
  UPDATE_BRANCH: string;
  DOUBAN_PROXY_TYPE: string;
  DOUBAN_PROXY: string;
  DOUBAN_IMAGE_PROXY_TYPE: string;
  DOUBAN_IMAGE_PROXY: string;
  ENABLE_LIVE_ENTRY: boolean;
  DEFAULT_AGGREGATE_SEARCH: boolean;
  ENABLE_OPTIMIZATION: boolean;
  AUTO_SWITCH_SOURCE: boolean;
  ENABLE_DANMAKU: boolean;
  ENABLE_USER_DANMAKU: boolean;
  CUSTOM_CATEGORIES: { name: string; type: 'movie' | 'tv'; query: string }[];
  FLUID_SEARCH: boolean;
  VOD_PAGE_TIMEOUT_SECONDS: number;
  VOD_FRAGMENT_TIMEOUT_SECONDS: number;
  IMAGE_PROXY_TIMEOUT_SECONDS: number;
  SOURCE_COVER_PROXY_MODE: SourceCoverProxyMode;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  STORAGE_TYPE:
    process.env.NEXT_PUBLIC_STORAGE_TYPE === 'mysql' ? 'mysql' : 'localdb',
  PASSWORD_REGISTER: false,
  LINUXDO_LOGIN: false,
  REQUIRE_INVITE_CODE: false,
  UPDATE_REPOS: 'naseaoi/IceTV',
  UPDATE_BRANCH: CURRENT_UPDATE_BRANCH,
  DOUBAN_PROXY_TYPE: DEFAULT_DOUBAN_PROXY_TYPE,
  DOUBAN_PROXY: '',
  DOUBAN_IMAGE_PROXY_TYPE: DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DOUBAN_IMAGE_PROXY: '',
  ENABLE_LIVE_ENTRY: false,
  DEFAULT_AGGREGATE_SEARCH: true,
  ENABLE_OPTIMIZATION: true,
  AUTO_SWITCH_SOURCE: true,
  ENABLE_DANMAKU: false,
  ENABLE_USER_DANMAKU: false,
  CUSTOM_CATEGORIES: [],
  FLUID_SEARCH: true,
  VOD_PAGE_TIMEOUT_SECONDS: 15,
  VOD_FRAGMENT_TIMEOUT_SECONDS: 10,
  IMAGE_PROXY_TIMEOUT_SECONDS: 15,
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
  PasswordRegister?: boolean;
  LinuxDoLogin?: boolean;
  RequireInviteCode?: boolean;
  UpdateRepos?: string;
  UpdateBranch?: string;
  DoubanProxyType?: string;
  DoubanProxy?: string;
  DoubanImageProxyType?: string;
  DoubanImageProxy?: string;
  EnableLiveEntry?: boolean;
  DefaultAggregateSearch?: boolean;
  EnableOptimization?: boolean;
  AutoSwitchSource?: boolean;
  EnableDanmaku?: boolean;
  EnableUserDanmaku?: boolean;
  CustomCategories?: RuntimeConfig['CUSTOM_CATEGORIES'];
  FluidSearch?: boolean;
  VodPageTimeoutSeconds?: number;
  VodFragmentTimeoutSeconds?: number;
  ImageProxyTimeoutSeconds?: number;
  SourceCoverProxyMode?: SourceCoverProxyMode;
};

declare global {
  interface Window {
    RUNTIME_CONFIG?: RuntimeConfig;
    __runtimeConfigReady?: boolean;
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
    LINUXDO_LOGIN: data.LinuxDoLogin ?? false,
    PASSWORD_REGISTER:
      data.PasswordRegister === undefined
        ? DEFAULT_RUNTIME_CONFIG.PASSWORD_REGISTER
        : data.PasswordRegister,
    REQUIRE_INVITE_CODE:
      data.RequireInviteCode === undefined
        ? DEFAULT_RUNTIME_CONFIG.REQUIRE_INVITE_CODE
        : data.RequireInviteCode,
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
    AUTO_SWITCH_SOURCE:
      data.AutoSwitchSource === undefined
        ? DEFAULT_RUNTIME_CONFIG.AUTO_SWITCH_SOURCE
        : data.AutoSwitchSource,
    ENABLE_DANMAKU:
      data.EnableDanmaku === undefined
        ? DEFAULT_RUNTIME_CONFIG.ENABLE_DANMAKU
        : data.EnableDanmaku,
    ENABLE_USER_DANMAKU:
      data.EnableUserDanmaku === undefined
        ? DEFAULT_RUNTIME_CONFIG.ENABLE_USER_DANMAKU
        : data.EnableUserDanmaku,
    CUSTOM_CATEGORIES:
      data.CustomCategories || DEFAULT_RUNTIME_CONFIG.CUSTOM_CATEGORIES,
    FLUID_SEARCH:
      data.FluidSearch === undefined
        ? DEFAULT_RUNTIME_CONFIG.FLUID_SEARCH
        : data.FluidSearch,
    VOD_PAGE_TIMEOUT_SECONDS:
      data.VodPageTimeoutSeconds ??
      DEFAULT_RUNTIME_CONFIG.VOD_PAGE_TIMEOUT_SECONDS,
    VOD_FRAGMENT_TIMEOUT_SECONDS:
      data.VodFragmentTimeoutSeconds ??
      DEFAULT_RUNTIME_CONFIG.VOD_FRAGMENT_TIMEOUT_SECONDS,
    IMAGE_PROXY_TIMEOUT_SECONDS:
      data.ImageProxyTimeoutSeconds ??
      DEFAULT_RUNTIME_CONFIG.IMAGE_PROXY_TIMEOUT_SECONDS,
    SOURCE_COVER_PROXY_MODE:
      data.SourceCoverProxyMode ??
      DEFAULT_RUNTIME_CONFIG.SOURCE_COVER_PROXY_MODE,
  };
}

export const SERVER_CONFIG_UPDATED_EVENT = 'server-config-updated';

export const CLIENT_SERVER_CONFIG_MAX_AGE_MS = 5 * 60_000;
export const SERVER_CONFIG_INVALIDATION_CHANNEL =
  'icetv:server-config-invalidated';
export const SERVER_CONFIG_INVALIDATION_SOURCE = Math.random();

let serverConfigRequest: Promise<ServerConfigPayload> | null = null;
let serverConfigRequestPending = false;
let serverConfigExpiresAt = 0;
let serverConfigScope = '';

function currentConfigScope(): string {
  const auth = getAuthInfoFromBrowserCookie();
  return JSON.stringify([auth?.username, auth?.role]);
}

export function invalidateClientServerConfig(): void {
  serverConfigRequest = null;
  serverConfigRequestPending = false;
  serverConfigExpiresAt = 0;
}

export async function fetchClientServerConfig({
  forceFresh = false,
}: { forceFresh?: boolean } = {}): Promise<ServerConfigPayload> {
  const scope = currentConfigScope();
  if (scope !== serverConfigScope) {
    invalidateClientServerConfig();
    serverConfigScope = scope;
  }
  if (
    forceFresh ||
    !serverConfigRequest ||
    (!serverConfigRequestPending && Date.now() >= serverConfigExpiresAt)
  ) {
    serverConfigExpiresAt = 0;
    const request: Promise<ServerConfigPayload> = fetch(
      forceFresh ? '/api/server-config?fresh=1' : '/api/server-config',
      { method: 'GET', cache: 'no-store' },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`server-config: ${response.status}`);
        }
        return response.json() as Promise<ServerConfigPayload>;
      })
      .then(
        // 保存前的请求即使晚到，也只向调用方交付最新请求的结果。
        (data) => {
          if (scope !== currentConfigScope() || !serverConfigRequest) {
            throw new Error('server-config: session changed');
          }
          if (serverConfigRequest !== request) return serverConfigRequest;
          serverConfigExpiresAt = Date.now() + CLIENT_SERVER_CONFIG_MAX_AGE_MS;
          return data;
        },
        (error) => {
          if (
            scope === currentConfigScope() &&
            serverConfigRequest &&
            serverConfigRequest !== request
          )
            return serverConfigRequest;
          throw error;
        },
      )
      .finally(() => {
        if (serverConfigRequest === request) serverConfigRequestPending = false;
      });
    serverConfigRequest = request;
    serverConfigRequestPending = true;
  }

  return serverConfigRequest;
}

export async function syncClientConfigAfterSave(): Promise<void> {
  clearSearchSnapshotCache();
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SERVER_CONFIG_INVALIDATION_CHANNEL);
    channel.postMessage({
      type: 'invalidate',
      source: SERVER_CONFIG_INVALIDATION_SOURCE,
    });
    channel.close();
  }
  try {
    applyClientServerConfig(
      await fetchClientServerConfig({ forceFresh: true }),
    );
  } catch (error) {
    console.warn('刷新客户端运行配置失败:', error);
  }
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
    window.dispatchEvent(
      new CustomEvent(SERVER_CONFIG_UPDATED_EVENT, { detail: data }),
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
  passwordRegister: boolean;
  linuxDoLogin: boolean;
  requireInviteCode: boolean;
}> {
  const runtimeConfig = await ensureClientRuntimeConfig();
  return {
    passwordRegister: runtimeConfig.PASSWORD_REGISTER,
    linuxDoLogin: runtimeConfig.LINUXDO_LOGIN,
    requireInviteCode: runtimeConfig.REQUIRE_INVITE_CODE,
  };
}
