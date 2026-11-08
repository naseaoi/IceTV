import 'server-only';

import {
  DEFAULT_BANGUMI_DATA_SOURCE,
  normalizeBangumiDataSource,
  normalizeSiteBangumiDataSource,
} from '@/lib/bangumi-source';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import { type ConfigStateUpdate, stripConfigState } from '@/lib/config-state';
import { db } from '@/lib/db';
import { PUBLIC_DOUBAN_IMAGE_PROXY_TYPES } from '@/lib/douban-image-url';
import {
  normalizeSiteDoubanImageProxyType,
  normalizeSiteDoubanProxyType,
} from '@/lib/douban-options';
import {
  type DoubanImageProxyType,
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DEFAULT_DOUBAN_PROXY_TYPE,
} from '@/lib/douban-source';
import { getOwnerUsername } from '@/lib/env.server';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
} from '@/lib/runtime-params';
import {
  DEFAULT_SITE_FOOTER_TEXT,
  normalizeSiteFooterText,
} from '@/lib/site-footer';
import {
  DEFAULT_SOURCE_COVER_PROXY_MODE,
  normalizeSourceCoverProxyMode,
} from '@/lib/source-cover-proxy';
import { normalizeUsername } from '@/lib/username';
import { AdminConfig } from '@/types/admin';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface LiveCfg {
  name: string;
  url: string;
  ua?: string;
  epg?: string; // 节目单
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site?: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  lives?: {
    [key: string]: LiveCfg;
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

let cachedConfig: AdminConfig;
let cachedConfigVersion = '';
let cachedConfigLoadedAt = 0;
let inflightConfigLoad: Promise<AdminConfig> | null = null;
let configCacheGeneration = 0;
const DEFAULT_CONFIG_CACHE_TTL_MS = 60_000;
const PUBLIC_DOUBAN_PROXY_TYPES = new Set([
  'direct',
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
  'cors-anywhere',
]);
const configVersionByObject = new WeakMap<AdminConfig, string>();

export function getPublicDoubanProxyType(
  proxyType: string | undefined,
): string {
  return proxyType && PUBLIC_DOUBAN_PROXY_TYPES.has(proxyType)
    ? proxyType
    : DEFAULT_DOUBAN_PROXY_TYPE;
}

export function getPublicBangumiDataSource(
  dataSource: string | undefined,
): string {
  return dataSource === 'direct' ? dataSource : DEFAULT_BANGUMI_DATA_SOURCE;
}

export function getPublicDoubanImageProxyType(
  proxyType: string | undefined,
): string {
  return proxyType &&
    PUBLIC_DOUBAN_IMAGE_PROXY_TYPES.has(proxyType as DoubanImageProxyType)
    ? proxyType
    : DEFAULT_DOUBAN_IMAGE_PROXY_TYPE;
}

// 从配置文件补充管理员配置
export function refineConfig(
  adminConfig: AdminConfig,
  configFile: string,
): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(configFile) as ConfigFileStruct;
  } catch (e) {
    console.warn('解析配置文件失败:', e);
    fileConfig = {} as ConfigFileStruct;
  }

  // 合并文件中的源信息
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s]),
  );

  apiSitesFromFile.forEach(([key, site]) => {
    if (isCatalogFavoriteSource(key))
      throw new Error('目录收藏标识不能用于播放源');
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      // 如果已存在，只覆盖 name、api、detail 和 from
      existingSource.name = site.name;
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      // 如果不存在，创建新条目
      currentApiSites.set(key, {
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有源是否在 fileConfig.api_site 中，如果不在则标记为 custom
  const apiSitesFromFileKey = new Set(apiSitesFromFile.map(([key]) => key));
  currentApiSites.forEach((source) => {
    if (!apiSitesFromFileKey.has(source.key)) {
      source.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 覆盖 CustomCategories
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c]),
  );

  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    const existedCategory = currentCustomCategories.get(key);
    if (existedCategory) {
      existedCategory.name = category.name;
      existedCategory.query = category.query;
      existedCategory.type = category.type;
      existedCategory.from = 'config';
    } else {
      currentCustomCategories.set(key, {
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有 CustomCategories 是否在 fileConfig.custom_category 中，如果不在则标记为 custom
  const customCategoriesFromFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type),
  );
  currentCustomCategories.forEach((category) => {
    if (!customCategoriesFromFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  const livesFromFile = Object.entries(fileConfig.lives || []);
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l]),
  );
  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = site.name;
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
    } else {
      // 如果不存在，创建新条目
      currentLives.set(key, {
        key,
        name: site.name,
        url: site.url,
        ua: site.ua,
        epg: site.epg,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有 LiveConfig 是否在 fileConfig.lives 中，如果不在则标记为 custom
  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.LiveConfig = Array.from(currentLives.values());

  return stripConfigState(adminConfig);
}

async function getInitConfig(
  configFile: string,
  subConfig: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  } = {
    URL: '',
    AutoUpdate: false,
    LastCheck: '',
  },
): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct;
  try {
    cfgFile = JSON.parse(configFile) as ConfigFileStruct;
  } catch (e) {
    console.warn('解析初始配置文件失败:', e);
    cfgFile = {} as ConfigFileStruct;
  }
  const adminConfig: AdminConfig = {
    ConfigFile: configFile,
    ConfigSubscribtion: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'IceTV',
      SiteIcon: '',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
      FooterText: DEFAULT_SITE_FOOTER_TEXT,
      EnableLiveEntry: false,
      LiveAccess: 'all',
      DefaultAggregateSearch: true,
      EnableOptimization: true,
      LiveDirectConnect: false,
      AutoSwitchSource: false,
      EnableDanmaku: false,
      EnableUserDanmaku: false,
      ...normalizeRuntimeParams({
        ...DEFAULT_RUNTIME_PARAMS,
        SearchDownstreamMaxPage:
          Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: cfgFile.cache_time || 7200,
      }),
      DoubanProxyType: process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
      BangumiDataSource: normalizeBangumiDataSource(
        process.env.NEXT_PUBLIC_BANGUMI_DATA_SOURCE,
      ),
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
        DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
      SourceCoverProxyMode: normalizeSourceCoverProxyMode(
        process.env.NEXT_PUBLIC_SOURCE_COVER_PROXY_MODE,
      ),
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
    },
    UserConfig: {
      OpenRegister: false,
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  // 从配置文件中补充源信息
  Object.entries(cfgFile.api_site || []).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key: key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });

  // 从配置文件中补充自定义分类信息
  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  // 从配置文件中补充直播源信息
  Object.entries(cfgFile.lives || []).forEach(([key, live]) => {
    if (!adminConfig.LiveConfig) {
      adminConfig.LiveConfig = [];
    }
    adminConfig.LiveConfig.push({
      key,
      name: live.name,
      url: live.url,
      ua: live.ua,
      epg: live.epg,
      from: 'config',
      disabled: false,
    });
  });

  return stripConfigState(adminConfig);
}

async function loadConfig(): Promise<AdminConfig> {
  if (cachedConfig && isCachedConfigFresh()) {
    return cachedConfig;
  }
  if (inflightConfigLoad) {
    return inflightConfigLoad;
  }

  const generation = configCacheGeneration;
  inflightConfigLoad = loadConfigUncached(generation).finally(() => {
    inflightConfigLoad = null;
  });
  return inflightConfigLoad;
}

const CONFIG_PERSIST_MAX_ATTEMPTS = 3;

async function loadConfigUncached(
  generation: number,
  attempt = 1,
): Promise<AdminConfig> {
  let adminConfig: AdminConfig | null;
  try {
    adminConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('获取管理员配置失败:', e);
    if (cachedConfig) {
      return cachedConfig;
    }
    throw e;
  }

  const wasMissing = !adminConfig;
  let shouldPersist = false;
  if (!adminConfig) {
    adminConfig = await getInitConfig('');
    shouldPersist = true;
  }
  const originalConfigJson = JSON.stringify(adminConfig);
  adminConfig = configSelfCheck(adminConfig);

  if (generation !== configCacheGeneration) {
    return cachedConfig;
  }

  cachedConfig = adminConfig;
  cachedConfigVersion = getConfigVersion(cachedConfig);
  cachedConfigLoadedAt = Date.now();
  bindConfigVersion(cachedConfig, cachedConfigVersion);

  if (!shouldPersist) {
    shouldPersist = JSON.stringify(cachedConfig) !== originalConfigJson;
  }

  if (shouldPersist) {
    try {
      const original = wasMissing
        ? null
        : (JSON.parse(originalConfigJson) as AdminConfig);
      if (!(await db.compareAndSetAdminConfig(original, cachedConfig))) {
        // 补写期间配置被并发改写：重读后再补，超过上限沿用本次结果，下次加载继续补齐。
        if (attempt >= CONFIG_PERSIST_MAX_ATTEMPTS) return cachedConfig;
        invalidateConfigCache();
        return loadConfigUncached(configCacheGeneration, attempt + 1);
      }
    } catch (e) {
      console.error('保存管理员配置失败:', e);
    }
  }

  return cachedConfig;
}

export async function getConfig(): Promise<AdminConfig> {
  return cloneConfig(await loadConfig());
}

export async function getConfigForRead(): Promise<Readonly<AdminConfig>> {
  return deepFreeze(await loadConfig());
}

// 让下一次读取跳过 TTL 缓存
export function invalidateConfigCache(): void {
  cachedConfigLoadedAt = 0;
  inflightConfigLoad = null;
}

// 绕过 TTL 缓存直读，供后台面板等必须看到最新写入的场景
export async function getConfigFresh(): Promise<Readonly<AdminConfig>> {
  invalidateConfigCache();
  return deepFreeze(await loadConfig());
}

function isCachedConfigFresh(): boolean {
  return Date.now() - cachedConfigLoadedAt < getConfigCacheTtlMs();
}

function getConfigCacheTtlMs(): number {
  const configured = Number.parseInt(process.env.CONFIG_CACHE_TTL_MS || '', 10);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_CONFIG_CACHE_TTL_MS;
}

export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  // 初始化必要属性
  if (!adminConfig.UserConfig) {
    adminConfig.UserConfig = {};
  }
  delete adminConfig.UserConfig.Users;
  if (Array.isArray(adminConfig.UserConfig.Tags)) {
    for (const tag of adminConfig.UserConfig.Tags) {
      if (tag && tag.allowLive !== true) delete tag.allowLive;
    }
  }
  if (typeof adminConfig.UserConfig.OpenRegister !== 'boolean') {
    adminConfig.UserConfig.OpenRegister = false;
  }
  if (typeof adminConfig.UserConfig.RequireInviteCode !== 'boolean') {
    adminConfig.UserConfig.RequireInviteCode = false;
  }
  const defaultGroup = adminConfig.UserConfig.DefaultUserGroup;
  if (
    typeof defaultGroup !== 'string' ||
    !adminConfig.UserConfig.Tags?.some((tag) => tag?.name === defaultGroup)
  ) {
    delete adminConfig.UserConfig.DefaultUserGroup;
  }
  delete adminConfig.UserConfig.InviteCodes;
  if (!adminConfig.SourceConfig || !Array.isArray(adminConfig.SourceConfig)) {
    adminConfig.SourceConfig = [];
  }
  if (
    !adminConfig.CustomCategories ||
    !Array.isArray(adminConfig.CustomCategories)
  ) {
    adminConfig.CustomCategories = [];
  }
  if (!adminConfig.LiveConfig || !Array.isArray(adminConfig.LiveConfig)) {
    adminConfig.LiveConfig = [];
  }
  if (!adminConfig.SiteConfig) {
    adminConfig.SiteConfig = {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'IceTV',
      SiteIcon: '',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
      FooterText: DEFAULT_SITE_FOOTER_TEXT,
      EnableLiveEntry: false,
      LiveAccess: 'all',
      DefaultAggregateSearch: true,
      EnableOptimization: true,
      LiveDirectConnect: false,
      AutoSwitchSource: false,
      EnableDanmaku: false,
      EnableUserDanmaku: false,
      ...normalizeRuntimeParams({
        ...DEFAULT_RUNTIME_PARAMS,
        SearchDownstreamMaxPage:
          Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: 7200,
      }),
      DoubanProxyType: process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
      BangumiDataSource: normalizeBangumiDataSource(
        process.env.NEXT_PUBLIC_BANGUMI_DATA_SOURCE,
      ),
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
        DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
      SourceCoverProxyMode: DEFAULT_SOURCE_COVER_PROXY_MODE,
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
    };
  }
  // 兼容旧配置：补全 SiteIcon 字段
  if (typeof adminConfig.SiteConfig.SiteIcon !== 'string') {
    adminConfig.SiteConfig.SiteIcon = '';
  }
  if (typeof adminConfig.SiteConfig.FooterText !== 'string') {
    adminConfig.SiteConfig.FooterText = DEFAULT_SITE_FOOTER_TEXT;
  }
  if (typeof adminConfig.SiteConfig.EnableLiveEntry !== 'boolean') {
    adminConfig.SiteConfig.EnableLiveEntry = false;
  }
  if (adminConfig.SiteConfig.LiveAccess !== 'groups') {
    adminConfig.SiteConfig.LiveAccess = 'all';
  }
  if (typeof adminConfig.SiteConfig.DefaultAggregateSearch !== 'boolean') {
    adminConfig.SiteConfig.DefaultAggregateSearch = true;
  }
  if (typeof adminConfig.SiteConfig.EnableOptimization !== 'boolean') {
    adminConfig.SiteConfig.EnableOptimization = true;
  }
  if (typeof adminConfig.SiteConfig.LiveDirectConnect !== 'boolean') {
    adminConfig.SiteConfig.LiveDirectConnect = false;
  }
  if (typeof adminConfig.SiteConfig.AutoSwitchSource !== 'boolean') {
    adminConfig.SiteConfig.AutoSwitchSource = false;
  }
  if (typeof adminConfig.SiteConfig.EnableDanmaku !== 'boolean') {
    adminConfig.SiteConfig.EnableDanmaku = false;
  }
  if (typeof adminConfig.SiteConfig.EnableUserDanmaku !== 'boolean') {
    adminConfig.SiteConfig.EnableUserDanmaku = false;
  }
  if (typeof adminConfig.SiteConfig.FluidSearch !== 'boolean') {
    adminConfig.SiteConfig.FluidSearch =
      process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false';
  }
  const site = adminConfig.SiteConfig;
  adminConfig.SiteConfig = {
    SiteName: site.SiteName,
    SiteIcon: site.SiteIcon,
    Announcement: site.Announcement,
    AnnouncementVersion: site.AnnouncementVersion,
    AnnouncementPublishedAt: site.AnnouncementPublishedAt,
    FooterText: site.FooterText,
    EnableLiveEntry: site.EnableLiveEntry,
    LiveAccess: site.LiveAccess,
    DefaultAggregateSearch: site.DefaultAggregateSearch,
    EnableOptimization: site.EnableOptimization,
    LiveDirectConnect: site.LiveDirectConnect,
    AutoSwitchSource: site.AutoSwitchSource,
    EnableDanmaku: site.EnableDanmaku,
    EnableUserDanmaku: site.EnableUserDanmaku,
    ...normalizeRuntimeParams(site),
    DoubanProxyType: normalizeSiteDoubanProxyType(site.DoubanProxyType),
    BangumiDataSource: normalizeSiteBangumiDataSource(
      site.BangumiDataSource || DEFAULT_BANGUMI_DATA_SOURCE,
    ),
    DoubanImageProxyType: normalizeSiteDoubanImageProxyType(
      site.DoubanImageProxyType,
    ),
    SourceCoverProxyMode: normalizeSourceCoverProxyMode(
      site.SourceCoverProxyMode,
    ),
    DisableYellowFilter: site.DisableYellowFilter,
    FluidSearch: site.FluidSearch,
  };

  // 视频源去重
  const seenSourceKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((source) => {
    if (seenSourceKeys.has(source.key)) {
      return false;
    }
    seenSourceKeys.add(source.key);
    return true;
  });

  // 自定义分类去重
  const seenCustomCategoryKeys = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter(
    (category) => {
      if (seenCustomCategoryKeys.has(category.query + category.type)) {
        return false;
      }
      seenCustomCategoryKeys.add(category.query + category.type);
      return true;
    },
  );

  // 直播源去重
  const seenLiveKeys = new Set<string>();
  adminConfig.LiveConfig = adminConfig.LiveConfig.map((live) => ({
    ...live,
    key: trimConfigString(live.key),
    name: trimConfigString(live.name),
    url: trimConfigString(live.url),
    ua: trimOptionalConfigString(live.ua),
    epg: trimOptionalConfigString(live.epg),
  })).filter((live) => {
    if (!live.key || !live.name || !live.url) {
      return false;
    }
    if (seenLiveKeys.has(live.key)) {
      return false;
    }
    seenLiveKeys.add(live.key);
    return true;
  });

  return stripConfigState(adminConfig);
}

function trimConfigString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trimOptionalConfigString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function resetConfig() {
  const adminConfig = await getInitConfig(
    (await db.getConfigSubscription()).ConfigFile,
  );
  await db.saveAdminConfig(adminConfig);
  configCacheGeneration += 1;
  cachedConfig = cloneConfig(adminConfig);
  cachedConfigVersion = getConfigVersion(cachedConfig);
  cachedConfigLoadedAt = Date.now();
  bindConfigVersion(cachedConfig, cachedConfigVersion);

  return;
}

export async function saveConfig(
  config: AdminConfig,
  state?: ConfigStateUpdate,
): Promise<AdminConfig> {
  const expectedVersion = configVersionByObject.get(config);
  const nextConfig = configSelfCheck(cloneConfig(config));
  const current = await db.getAdminConfig();
  if (
    expectedVersion &&
    (!current ||
      getConfigVersion(configSelfCheck(cloneConfig(current))) !==
        expectedVersion)
  ) {
    throw new ConfigConflictError();
  }
  if (!(await db.compareAndSetAdminConfig(current, nextConfig, state))) {
    throw new ConfigConflictError();
  }
  configCacheGeneration += 1;
  cachedConfig = cloneConfig(nextConfig);
  cachedConfigVersion = getConfigVersion(cachedConfig);
  cachedConfigLoadedAt = Date.now();
  bindConfigVersion(cachedConfig, cachedConfigVersion);
  return cloneConfig(cachedConfig);
}

export class ConfigConflictError extends Error {
  constructor() {
    super('配置已被其他操作更新，请刷新后重试');
    this.name = 'ConfigConflictError';
  }
}

export function getCacheTime(config: Readonly<AdminConfig>): number;
export function getCacheTime(): Promise<number>;
export function getCacheTime(
  config?: Readonly<AdminConfig>,
): number | Promise<number> {
  if (config) {
    return normalizeRuntimeParams(config.SiteConfig).SiteInterfaceCacheTime;
  }

  if (cachedConfig && isCachedConfigFresh()) {
    return normalizeRuntimeParams(cachedConfig.SiteConfig)
      .SiteInterfaceCacheTime;
  }

  return getConfigForRead().then(
    (currentConfig) =>
      normalizeRuntimeParams(currentConfig.SiteConfig).SiteInterfaceCacheTime,
  );
}

export async function getAvailableApiSites(
  user?: string,
  config?: Readonly<AdminConfig>,
): Promise<ApiSite[]> {
  const currentConfig = config || (await getConfigForRead());
  const enabledSources = currentConfig.SourceConfig.filter((s) => !s.disabled);

  if (!user) {
    return enabledSources.map(toApiSite);
  }

  const lookupUsername = normalizeUsername(user);
  const userConfig = await db.getUserAccess(lookupUsername);
  const isStaff =
    lookupUsername === normalizeUsername(getOwnerUsername()) ||
    userConfig?.role === 'admin' ||
    userConfig?.role === 'owner';
  const allApiSites = (
    isStaff ? enabledSources : enabledSources.filter((s) => !s.adminOnly)
  ).map(toApiSite);
  if (!userConfig) {
    return allApiSites;
  }

  // 优先根据用户自己的 enabledApis 配置查找
  if (userConfig.enabledApis && userConfig.enabledApis.length > 0) {
    const userApiSitesSet = new Set(userConfig.enabledApis);
    return allApiSites
      .filter((s) => userApiSitesSet.has(s.key))
      .map((s) => ({
        key: s.key,
        name: s.name,
        api: s.api,
        detail: s.detail,
      }));
  }

  // 如果没有 enabledApis 配置，则根据 tags 查找
  if (
    userConfig.tags &&
    userConfig.tags.length > 0 &&
    currentConfig.UserConfig.Tags
  ) {
    const enabledApisFromTags = new Set<string>();

    userConfig.tags.forEach((tagName) => {
      const tagConfig = currentConfig.UserConfig.Tags?.find(
        (t) => t.name === tagName,
      );
      if (tagConfig && tagConfig.enabledApis) {
        tagConfig.enabledApis.forEach((apiKey) =>
          enabledApisFromTags.add(apiKey),
        );
      }
    });

    if (enabledApisFromTags.size > 0) {
      return allApiSites
        .filter((s) => enabledApisFromTags.has(s.key))
        .map((s) => ({
          key: s.key,
          name: s.name,
          api: s.api,
          detail: s.detail,
        }));
    }
  }

  // 如果都没有配置，返回所有可用的 API 站点
  return allApiSites;
}

function toApiSite(site: ApiSite): ApiSite {
  return {
    key: site.key,
    name: site.name,
    api: site.api,
    detail: site.detail,
  };
}

export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = configSelfCheck(cloneConfig(config));
  cachedConfigVersion = getConfigVersion(cachedConfig);
  cachedConfigLoadedAt = Date.now();
  bindConfigVersion(cachedConfig, cachedConfigVersion);
}

function cloneConfig(config: AdminConfig): AdminConfig {
  const cloned = JSON.parse(JSON.stringify(config)) as AdminConfig;
  const version = configVersionByObject.get(config);
  if (version) {
    bindConfigVersion(cloned, version);
  }
  return cloned;
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  Object.freeze(value);

  for (const item of Object.values(value)) {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      deepFreeze(item as object);
    }
  }

  return value;
}

function bindConfigVersion(config: AdminConfig, version: string): AdminConfig {
  configVersionByObject.set(config, version);
  return config;
}

function getConfigVersion(config: AdminConfig): string {
  return JSON.stringify(config);
}

export async function getPublicConfig() {
  const config = await getConfigForRead();

  return {
    SiteName: config.SiteConfig.SiteName,
    SiteIcon: config.SiteConfig.SiteIcon || '',
    Announcement: config.SiteConfig.Announcement,
    FooterText: normalizeSiteFooterText(config.SiteConfig.FooterText),
    OpenRegister: !!config.UserConfig.OpenRegister,
    RequireInviteCode: !!config.UserConfig.RequireInviteCode,
    EnableLiveEntry: config.SiteConfig.EnableLiveEntry,
    DefaultAggregateSearch: config.SiteConfig.DefaultAggregateSearch,
    EnableOptimization: config.SiteConfig.EnableOptimization,
    LiveDirectConnect: config.SiteConfig.LiveDirectConnect,
    AutoSwitchSource: config.SiteConfig.AutoSwitchSource,
    EnableDanmaku: config.SiteConfig.EnableDanmaku,
    EnableUserDanmaku: config.SiteConfig.EnableUserDanmaku,
    ...normalizeRuntimeParams(config.SiteConfig),
    DoubanProxyType: getPublicDoubanProxyType(
      config.SiteConfig.DoubanProxyType,
    ),
    BangumiDataSource: getPublicBangumiDataSource(
      config.SiteConfig.BangumiDataSource,
    ),
    DoubanImageProxyType: getPublicDoubanImageProxyType(
      config.SiteConfig.DoubanImageProxyType,
    ),
    SourceCoverProxyMode: normalizeSourceCoverProxyMode(
      config.SiteConfig.SourceCoverProxyMode,
    ),
    CustomCategories: config.CustomCategories.filter(
      (category) => !category.disabled,
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    })),
    FluidSearch: config.SiteConfig.FluidSearch,
  };
}
