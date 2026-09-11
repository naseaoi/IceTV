import { randomUUID } from 'crypto';

import { AdminConfig } from '@/types/admin';

import { configSelfCheck } from './config';
import { getOwnerUsername } from './env.server';
import { hashPassword } from './password';
import { normalizeRuntimeParams } from './runtime-params';
import {
  type SiteIconBackup,
  isSupportedSiteIconExtension,
} from './site-icon-storage.server';
import {
  Favorite,
  PlaybackSession,
  PlayRecord,
  SkipConfig,
  SourceRouteStatsBucket,
  StorageImportData,
  StorageUserImportData,
} from './types';
import { normalizeUsername } from './username';
import { parseStorageKey } from './utils';

const MAX_USERS = 1000;
const MAX_RECORDS_PER_USER = 20000;
const MAX_FAVORITES_PER_USER = 20000;
const MAX_PLAYBACK_SESSIONS_PER_USER = 500;
const MAX_SKIP_CONFIGS_PER_USER = 2000;
const MAX_SEARCH_HISTORY = 20;
const MAX_TOTAL_ITEMS = 150000;
const MAX_USERNAME_LENGTH = 191;
const MAX_KEY_LENGTH = 255;
const MAX_SHORT_STRING_LENGTH = 4096;
const MAX_LONG_STRING_LENGTH = 2000000;
const MAX_SECONDS = 365 * 24 * 60 * 60;
const MAX_SOURCE_ROUTE_STATS = 20000;
const MAX_ROUTE_STAT_COUNT = 1000000000;
const MAX_INVITE_CODE_USAGE = 1000;
const MAX_INVITE_CODE_USED = 1000000;
// 512KB 原始上限，base64 后约 4/3
const MAX_SITE_ICON_BASE64 = Math.ceil((512 * 1024 * 4) / 3) + 8;
const MAX_TIMESTAMP_MS = 4102444800000;

export class ImportValidationError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ImportValidationError';
  }
}

export type TruncationKind = 'searchHistory' | 'playbackSessions';

export type TruncationReport = {
  username: string;
  kind: TruncationKind;
  dropped: number;
};

// 导入时被上限裁掉的条目，用于回报给站长而不是静默丢弃
class TruncationCollector {
  private readonly items: TruncationReport[] = [];

  add(username: string, kind: TruncationKind, dropped: number): void {
    if (dropped <= 0) return;
    this.items.push({ username, kind, dropped });
  }

  rename(from: string, to: string): void {
    for (const item of this.items) {
      if (item.username === from) {
        item.username = to;
      }
    }
  }

  toArray(): TruncationReport[] {
    return this.items;
  }
}

export type ParsedImportData = {
  snapshot: StorageImportData;
  importedUsers: number;
  timestamp?: string;
  serverVersion: string;
  ownerRemappedFrom?: string;
  siteIcon: SiteIconBackup | null;
  truncated: TruncationReport[];
};

export async function parseImportData(
  input: unknown,
): Promise<ParsedImportData> {
  const root = requireObject(input, '备份文件格式错误');
  const data = requireObject(root.data, '备份文件格式无效');
  const adminConfig = normalizeAdminConfig(data.adminConfig);
  const userDataInput = requireObject(data.userData, '备份文件格式无效');
  const importedPasswords = normalizeImportedPasswords(data.users);
  const sourceRouteStats = normalizeSourceRouteStats(data.sourceRouteStats);
  const inviteCodeUsage = normalizeInviteCodeUsage(data.inviteCodeUsage);
  const siteIcon = normalizeSiteIcon(data.siteIcon);
  const userEntries = Object.entries(userDataInput);

  if (userEntries.length > MAX_USERS) {
    throw new ImportValidationError('用户数量超出限制', 413);
  }

  const localOwner = normalizeUsername(getOwnerUsername() || '');
  const backupOwner = normalizeBackupOwner(root.ownerUsername);
  const shouldRemapOwner = Boolean(
    backupOwner && localOwner && backupOwner !== localOwner,
  );

  if (shouldRemapOwner && hasUser(userDataInput, localOwner)) {
    throw new ImportValidationError(
      `备份中已存在与本机站长同名的用户 ${localOwner}，无法迁移站长 ${backupOwner} 的数据，请先在原站重命名该用户`,
    );
  }

  let totalItems = 0;
  let ownerRemappedFrom: string | undefined;
  const users: Record<string, string> = {};
  const userData: Record<string, StorageUserImportData> = {};
  const truncated = new TruncationCollector();

  for (const [username, rawUserData] of userEntries) {
    assertKey(username, '用户名', MAX_USERNAME_LENGTH);
    const normalizedUserData = normalizeUserData(
      rawUserData,
      username,
      adminConfig.SiteConfig.SearchHistoryLimit,
      adminConfig.SiteConfig.DataImportPlaybackSessionsLimit,
      truncated,
    );
    totalItems +=
      Object.keys(normalizedUserData.playRecords).length +
      Object.keys(normalizedUserData.favorites).length +
      normalizedUserData.searchHistory.length +
      Object.keys(normalizedUserData.skipConfigs).length +
      Object.keys(normalizedUserData.playbackSessions).length;

    if (totalItems > MAX_TOTAL_ITEMS) {
      throw new ImportValidationError('导入数据量超出限制', 413);
    }

    const normalizedName = normalizeUsername(username);
    const isBackupOwner =
      Boolean(backupOwner) && normalizedName === backupOwner;
    const targetName =
      shouldRemapOwner && isBackupOwner ? localOwner : normalizedName;
    if (shouldRemapOwner && isBackupOwner) {
      ownerRemappedFrom = backupOwner;
    }

    if (targetName !== normalizedName) {
      truncated.rename(username, targetName);
    }

    userData[targetName] = normalizedUserData;
    // 站长凭据来自环境变量，不写 users 表
    if (targetName !== localOwner) {
      users[targetName] =
        importedPasswords[normalizedName] ?? (await hashPassword(randomUUID()));
    }
  }

  alignConfigOwner(adminConfig, localOwner, backupOwner);

  return {
    snapshot: {
      adminConfig,
      users,
      userData,
      sourceRouteStats,
      inviteCodeUsage,
    },
    importedUsers: userEntries.length,
    timestamp:
      typeof root.timestamp === 'string'
        ? limitString(root.timestamp, 'timestamp', MAX_SHORT_STRING_LENGTH)
        : undefined,
    serverVersion:
      typeof root.serverVersion === 'string'
        ? limitString(
            root.serverVersion,
            'serverVersion',
            MAX_SHORT_STRING_LENGTH,
          )
        : '未知版本',
    ...(ownerRemappedFrom ? { ownerRemappedFrom } : {}),
    siteIcon,
    truncated: truncated.toArray(),
  };
}

function normalizeSiteIcon(value: unknown): SiteIconBackup | null {
  if (value === undefined || value === null) {
    return null;
  }
  const input = requireObject(value, '站点图标格式无效');
  const extension = limitString(input.extension, '站点图标扩展名', 16);
  if (!isSupportedSiteIconExtension(extension)) {
    throw new ImportValidationError('站点图标格式无效');
  }

  const base64 = limitString(
    input.base64,
    '站点图标数据',
    MAX_SITE_ICON_BASE64,
  );
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new ImportValidationError('站点图标数据格式无效');
  }

  return { extension, base64 };
}

function normalizeBackupOwner(value: unknown): string {
  if (value === undefined || value === null) return '';
  return normalizeUsername(
    limitString(value, '备份站长用户名', MAX_USERNAME_LENGTH),
  );
}

function hasUser(userDataInput: Record<string, any>, target: string): boolean {
  return Object.keys(userDataInput).some(
    (name) => normalizeUsername(name) === target,
  );
}

// 站长条目按本机环境变量重写，避免面板里残留原站站长
function alignConfigOwner(
  config: AdminConfig,
  localOwner: string,
  backupOwner: string,
): void {
  if (!localOwner) return;

  const users = config.UserConfig.Users;
  const kept = users
    .filter((user) => {
      const name = normalizeUsername(user.username);
      return name !== localOwner && !(backupOwner && name === backupOwner);
    })
    // 本机只能有一个站长，原站遗留的 owner 降级
    .map((user) =>
      user.role === 'owner' ? { ...user, role: 'user' as const } : user,
    );
  const previousOwner = users.find(
    (user) =>
      normalizeUsername(user.username) === localOwner ||
      (backupOwner && normalizeUsername(user.username) === backupOwner),
  );

  config.UserConfig.Users = [
    {
      username: localOwner,
      role: 'owner',
      banned: false,
      ...(previousOwner?.enabledApis
        ? { enabledApis: [...previousOwner.enabledApis] }
        : {}),
      ...(previousOwner?.tags ? { tags: [...previousOwner.tags] } : {}),
    },
    ...kept,
  ];
}

function normalizeInviteCodeUsage(value: unknown): Record<string, number> {
  if (value === undefined || value === null) {
    return {};
  }
  const input = requireObject(value, '邀请码用量格式无效');
  const entries = Object.entries(input);
  if (entries.length > MAX_INVITE_CODE_USAGE) {
    throw new ImportValidationError('邀请码用量数量超出限制', 413);
  }

  const output: Record<string, number> = {};
  for (const [code, used] of entries) {
    assertKey(code, '邀请码', MAX_KEY_LENGTH);
    output[code] = Math.floor(
      assertBoundedNumber(used, '邀请码已用次数', 0, MAX_INVITE_CODE_USED),
    );
  }
  return output;
}

function normalizeImportedPasswords(value: unknown): Record<string, string> {
  if (value === undefined || value === null) {
    return {};
  }
  const input = requireObject(value, '用户密码格式无效');
  const entries = Object.entries(input);
  if (entries.length > MAX_USERS) {
    throw new ImportValidationError('用户数量超出限制', 413);
  }

  const output: Record<string, string> = {};
  for (const [username, password] of entries) {
    assertKey(username, '用户名', MAX_USERNAME_LENGTH);
    const stored = limitString(password, '用户密码', MAX_SHORT_STRING_LENGTH);
    if (stored) {
      output[normalizeUsername(username)] = stored;
    }
  }
  return output;
}

function normalizeSourceRouteStats(value: unknown): SourceRouteStatsBucket[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ImportValidationError('源站路由统计格式无效');
  }
  if (value.length > MAX_SOURCE_ROUTE_STATS) {
    throw new ImportValidationError('源站路由统计数量超出限制', 413);
  }

  const seen = new Set<string>();
  const output: SourceRouteStatsBucket[] = [];
  for (const item of value) {
    const input = requireObject(item, '源站路由统计条目格式无效');
    const source = limitString(
      input.source,
      '源站路由统计 source',
      MAX_KEY_LENGTH,
    );
    if (!source.trim()) {
      throw new ImportValidationError('源站路由统计 source 不能为空');
    }
    if (input.routeMode !== 'browser' && input.routeMode !== 'server') {
      throw new ImportValidationError('源站路由统计模式格式无效');
    }
    const bucketDate = limitString(input.bucketDate, '源站路由统计日期', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bucketDate)) {
      throw new ImportValidationError('源站路由统计日期格式无效');
    }
    const key = `${source}:${input.routeMode}:${bucketDate}`;
    if (seen.has(key)) {
      throw new ImportValidationError('源站路由统计条目重复');
    }
    seen.add(key);

    output.push({
      source,
      routeMode: input.routeMode,
      bucketDate,
      successCount: Math.floor(
        assertBoundedNumber(
          input.successCount,
          '源站路由统计成功数',
          0,
          MAX_ROUTE_STAT_COUNT,
        ),
      ),
      failureCount: Math.floor(
        assertBoundedNumber(
          input.failureCount,
          '源站路由统计失败数',
          0,
          MAX_ROUTE_STAT_COUNT,
        ),
      ),
    });
  }
  return output;
}

function normalizeAdminConfig(value: unknown): AdminConfig {
  const cloned = cloneJson(requireObject(value, '管理员配置格式无效'));
  const config = configSelfCheck(cloned as AdminConfig);

  requireObject(config.ConfigSubscribtion, '订阅配置格式无效');
  limitString(
    config.ConfigSubscribtion.URL,
    '订阅地址',
    MAX_LONG_STRING_LENGTH,
  );
  assertBoolean(config.ConfigSubscribtion.AutoUpdate, '自动更新');
  limitString(
    config.ConfigSubscribtion.LastCheck,
    '订阅检查时间',
    MAX_SHORT_STRING_LENGTH,
  );

  limitString(config.ConfigFile, '配置文件', MAX_LONG_STRING_LENGTH);
  requireObject(config.SiteConfig, '站点配置格式无效');
  limitString(config.SiteConfig.SiteName, '站点名称', MAX_SHORT_STRING_LENGTH);
  limitString(config.SiteConfig.SiteIcon, '站点图标', MAX_LONG_STRING_LENGTH);
  limitString(config.SiteConfig.Announcement, '公告', MAX_LONG_STRING_LENGTH);
  limitString(config.SiteConfig.FooterText, '底部声明', MAX_LONG_STRING_LENGTH);
  assertBoolean(config.SiteConfig.EnableLiveEntry, '直播入口');
  assertBoolean(config.SiteConfig.DefaultAggregateSearch, '默认聚合搜索');
  assertBoolean(config.SiteConfig.EnableOptimization, '优选和测速');
  assertBoolean(config.SiteConfig.LiveDirectConnect, 'IPTV直连');
  assertFiniteNumber(config.SiteConfig.SearchDownstreamMaxPage, '搜索页数');
  assertFiniteNumber(config.SiteConfig.SiteInterfaceCacheTime, '缓存时间');
  const runtimeParams = normalizeRuntimeParams(config.SiteConfig);
  for (const [key, value] of Object.entries(runtimeParams)) {
    assertFiniteNumber(value, key);
  }
  limitString(
    config.SiteConfig.DoubanProxyType,
    '豆瓣代理类型',
    MAX_SHORT_STRING_LENGTH,
  );
  limitString(
    config.SiteConfig.DoubanProxy,
    '豆瓣代理',
    MAX_LONG_STRING_LENGTH,
  );
  limitString(
    config.SiteConfig.BangumiDataSource,
    'Bangumi数据代理类型',
    MAX_SHORT_STRING_LENGTH,
  );
  limitString(
    config.SiteConfig.BangumiProxy,
    'Bangumi代理',
    MAX_LONG_STRING_LENGTH,
  );
  limitString(
    config.SiteConfig.DoubanImageProxyType,
    '豆瓣图片代理类型',
    MAX_SHORT_STRING_LENGTH,
  );
  limitString(
    config.SiteConfig.DoubanImageProxy,
    '豆瓣图片代理',
    MAX_LONG_STRING_LENGTH,
  );
  assertBoolean(config.SiteConfig.DisableYellowFilter, '黄色过滤');
  assertBoolean(config.SiteConfig.FluidSearch, '流式搜索');

  validateUserConfig(config);
  validateSourceConfig(config);
  validateCustomCategories(config);
  validateLiveConfig(config);

  return config;
}

function validateUserConfig(config: AdminConfig): void {
  requireObject(config.UserConfig, '用户配置格式无效');
  if (!Array.isArray(config.UserConfig.Users)) {
    throw new ImportValidationError('用户列表格式无效');
  }
  if (config.UserConfig.Users.length > MAX_USERS) {
    throw new ImportValidationError('用户数量超出限制', 413);
  }
  for (const user of config.UserConfig.Users) {
    requireObject(user, '用户条目格式无效');
    limitString(user.username, '用户名', MAX_USERNAME_LENGTH);
    if (
      user.role !== 'owner' &&
      user.role !== 'admin' &&
      user.role !== 'user'
    ) {
      throw new ImportValidationError('用户角色格式无效');
    }
    if (user.banned !== undefined) {
      assertBoolean(user.banned, '封禁状态');
    }
    if (user.enabledApis !== undefined) {
      assertStringArray(user.enabledApis, '用户视频源权限', MAX_KEY_LENGTH);
    }
    if (user.tags !== undefined) {
      assertStringArray(user.tags, '用户标签', MAX_SHORT_STRING_LENGTH);
    }
  }

  if (config.UserConfig.OpenRegister !== undefined) {
    assertBoolean(config.UserConfig.OpenRegister, '开放注册');
  }

  if (config.UserConfig.Tags !== undefined) {
    if (!Array.isArray(config.UserConfig.Tags)) {
      throw new ImportValidationError('用户组格式无效');
    }
    for (const tag of config.UserConfig.Tags) {
      requireObject(tag, '用户组条目格式无效');
      limitString(tag.name, '用户组名称', MAX_SHORT_STRING_LENGTH);
      assertStringArray(tag.enabledApis, '用户组视频源权限', MAX_KEY_LENGTH);
    }
  }
}

function validateSourceConfig(config: AdminConfig): void {
  if (!Array.isArray(config.SourceConfig)) {
    throw new ImportValidationError('视频源配置格式无效');
  }
  for (const source of config.SourceConfig) {
    requireObject(source, '视频源条目格式无效');
    assertKey(source.key, '视频源 key', MAX_KEY_LENGTH);
    limitString(source.name, '视频源名称', MAX_SHORT_STRING_LENGTH);
    limitString(source.api, '视频源地址', MAX_LONG_STRING_LENGTH);
    if (source.detail !== undefined) {
      limitString(source.detail, '视频源详情地址', MAX_LONG_STRING_LENGTH);
    }
    if (source.from !== 'config' && source.from !== 'custom') {
      throw new ImportValidationError('视频源来源格式无效');
    }
    if (source.disabled !== undefined) {
      assertBoolean(source.disabled, '视频源状态');
    }
    if (source.proxyMode !== undefined) {
      if (
        source.proxyMode !== 'server' &&
        source.proxyMode !== 'browser' &&
        source.proxyMode !== 'auto'
      ) {
        throw new ImportValidationError('视频源代理模式格式无效');
      }
    }
  }
}

function validateCustomCategories(config: AdminConfig): void {
  if (!Array.isArray(config.CustomCategories)) {
    throw new ImportValidationError('自定义分类格式无效');
  }
  for (const category of config.CustomCategories) {
    requireObject(category, '自定义分类条目格式无效');
    if (category.name !== undefined) {
      limitString(category.name, '分类名称', MAX_SHORT_STRING_LENGTH);
    }
    if (category.type !== 'movie' && category.type !== 'tv') {
      throw new ImportValidationError('分类类型格式无效');
    }
    limitString(category.query, '分类查询', MAX_SHORT_STRING_LENGTH);
    if (category.from !== 'config' && category.from !== 'custom') {
      throw new ImportValidationError('分类来源格式无效');
    }
    if (category.disabled !== undefined) {
      assertBoolean(category.disabled, '分类状态');
    }
  }
}

function validateLiveConfig(config: AdminConfig): void {
  if (!Array.isArray(config.LiveConfig)) {
    throw new ImportValidationError('直播源配置格式无效');
  }
  for (const source of config.LiveConfig) {
    requireObject(source, '直播源条目格式无效');
    assertKey(source.key, '直播源 key', MAX_KEY_LENGTH);
    limitString(source.name, '直播源名称', MAX_SHORT_STRING_LENGTH);
    limitString(source.url, '直播源地址', MAX_LONG_STRING_LENGTH);
    if (source.ua !== undefined) {
      limitString(source.ua, '直播源 UA', MAX_SHORT_STRING_LENGTH);
    }
    if (source.epg !== undefined) {
      limitString(source.epg, '直播源 EPG', MAX_LONG_STRING_LENGTH);
    }
    if (source.from !== 'config' && source.from !== 'custom') {
      throw new ImportValidationError('直播源来源格式无效');
    }
    if (source.channelNumber !== undefined) {
      assertFiniteNumber(source.channelNumber, '直播频道数');
    }
    if (source.disabled !== undefined) {
      assertBoolean(source.disabled, '直播源状态');
    }
  }
}

function normalizeUserData(
  value: unknown,
  username: string,
  searchHistoryLimit: number,
  playbackSessionsLimit: number,
  truncated: TruncationCollector,
): StorageUserImportData {
  const input = requireObject(value, `用户 ${username} 数据格式无效`);
  return {
    playRecords: normalizeRecordMap(
      input.playRecords,
      '播放记录',
      MAX_RECORDS_PER_USER,
      normalizePlayRecord,
    ),
    favorites: normalizeRecordMap(
      input.favorites,
      '收藏',
      MAX_FAVORITES_PER_USER,
      normalizeFavorite,
    ),
    searchHistory: normalizeSearchHistory(
      input.searchHistory,
      searchHistoryLimit,
      username,
      truncated,
    ),
    skipConfigs: normalizeRecordMap(
      input.skipConfigs,
      '跳过配置',
      MAX_SKIP_CONFIGS_PER_USER,
      normalizeSkipConfig,
      true,
    ),
    playbackSessions: normalizePlaybackSessions(
      input.playbackSessions,
      playbackSessionsLimit || MAX_PLAYBACK_SESSIONS_PER_USER,
      username,
      truncated,
    ),
    messageState: normalizeMessageState(input.messageState),
    ...(input.danmakuEnabled === undefined
      ? {}
      : {
          danmakuEnabled: assertBoolean(input.danmakuEnabled, '弹幕开关'),
        }),
    lastLoginAt: normalizeLastLoginAt(input.lastLoginAt),
  };
}

function normalizeLastLoginAt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return Math.floor(
    assertBoundedNumber(value, '最后登录时间', 0, MAX_TIMESTAMP_MS),
  );
}

function normalizeMessageState(value: unknown) {
  if (value === undefined || value === null) return {};
  const input = requireObject(value, '消息状态格式无效');
  const readAnnouncementId = input.readAnnouncementId;
  if (
    readAnnouncementId !== undefined &&
    (typeof readAnnouncementId !== 'string' || readAnnouncementId.length > 128)
  ) {
    throw new ImportValidationError('公告已读状态格式无效');
  }
  return readAnnouncementId ? { readAnnouncementId } : {};
}

// 超出上限时保留最新的会话，避免整体导入失败
function normalizePlaybackSessions(
  value: unknown,
  limit: number,
  username: string,
  truncated: TruncationCollector,
): Record<string, PlaybackSession> {
  if (value === undefined || value === null) {
    return {};
  }
  const input = requireObject(value, '播放统计格式无效');

  const sessions: [string, PlaybackSession][] = [];
  for (const [key, item] of Object.entries(input)) {
    assertKey(key, '播放统计 key', MAX_KEY_LENGTH);
    sessions.push([key, normalizePlaybackSession(item, key)]);
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  if (sessions.length > safeLimit) {
    truncated.add(username, 'playbackSessions', sessions.length - safeLimit);
    sessions.sort(([, a], [, b]) => b.started_at - a.started_at);
    sessions.length = safeLimit;
  }
  return Object.fromEntries(sessions);
}

function normalizeRecordMap<T>(
  value: unknown,
  label: string,
  maxEntries: number,
  normalizeValue: (value: unknown, key: string) => T,
  requireStorageKey: boolean = false,
): Record<string, T> {
  if (value === undefined || value === null) {
    return {};
  }
  const input = requireObject(value, `${label}格式无效`);
  const entries = Object.entries(input);
  if (entries.length > maxEntries) {
    throw new ImportValidationError(`${label}数量超出限制`, 413);
  }

  const output: Record<string, T> = {};
  for (const [key, item] of entries) {
    assertKey(key, `${label} key`, MAX_KEY_LENGTH);
    if (requireStorageKey && !parseStorageKey(key)) {
      throw new ImportValidationError(`${label} key 格式无效`);
    }
    output[key] = normalizeValue(item, key);
  }
  return output;
}

function normalizePlayRecord(value: unknown): PlayRecord {
  const input = requireObject(value, '播放记录格式无效');
  if ((input.group_index === undefined) !== (input.group_total === undefined)) {
    throw new ImportValidationError('组内集数与组内总集数必须成对出现');
  }
  return {
    title: limitString(input.title, '标题', MAX_SHORT_STRING_LENGTH),
    source_name: limitString(
      input.source_name,
      '源名称',
      MAX_SHORT_STRING_LENGTH,
    ),
    cover: limitString(input.cover, '封面', MAX_LONG_STRING_LENGTH),
    year: limitString(input.year, '年份', MAX_SHORT_STRING_LENGTH),
    index: assertFiniteNumber(input.index, '集数'),
    total_episodes: assertFiniteNumber(input.total_episodes, '总集数'),
    ...(input.group_index === undefined
      ? {}
      : {
          group_index: assertBoundedNumber(
            input.group_index,
            '组内集数',
            1,
            10000,
          ),
        }),
    ...(input.group_total === undefined
      ? {}
      : {
          group_total: assertBoundedNumber(
            input.group_total,
            '组内总集数',
            1,
            10000,
          ),
        }),
    ...(input.group_label === undefined
      ? {}
      : {
          group_label: limitString(
            input.group_label,
            '分组标签',
            MAX_SHORT_STRING_LENGTH,
          ),
        }),
    play_time: assertBoundedNumber(input.play_time, '播放进度', 0, MAX_SECONDS),
    total_time: assertBoundedNumber(input.total_time, '总时长', 0, MAX_SECONDS),
    save_time: assertFiniteNumber(input.save_time, '保存时间'),
    ...(input.metadata_checked_at === undefined
      ? {}
      : {
          metadata_checked_at: assertBoundedNumber(
            input.metadata_checked_at,
            '元数据检查时间',
            0,
            Number.MAX_SAFE_INTEGER,
          ),
        }),
    search_title: optionalString(
      input.search_title,
      '搜索标题',
      MAX_SHORT_STRING_LENGTH,
      '',
    ),
  };
}

function normalizeFavorite(value: unknown): Favorite {
  const input = requireObject(value, '收藏格式无效');
  const origin = input.origin;
  if (origin !== undefined && origin !== 'vod' && origin !== 'live') {
    throw new ImportValidationError('收藏来源格式无效');
  }
  return {
    source_name: limitString(
      input.source_name,
      '源名称',
      MAX_SHORT_STRING_LENGTH,
    ),
    total_episodes: assertFiniteNumber(input.total_episodes, '总集数'),
    title: limitString(input.title, '标题', MAX_SHORT_STRING_LENGTH),
    year: limitString(input.year, '年份', MAX_SHORT_STRING_LENGTH),
    cover: limitString(input.cover, '封面', MAX_LONG_STRING_LENGTH),
    save_time: assertFiniteNumber(input.save_time, '保存时间'),
    ...(input.metadata_checked_at === undefined
      ? {}
      : {
          metadata_checked_at: assertBoundedNumber(
            input.metadata_checked_at,
            '元数据检查时间',
            0,
            Number.MAX_SAFE_INTEGER,
          ),
        }),
    search_title: optionalString(
      input.search_title,
      '搜索标题',
      MAX_SHORT_STRING_LENGTH,
      '',
    ),
    ...(origin ? { origin } : {}),
  };
}

function normalizeSearchHistory(
  value: unknown,
  limit = MAX_SEARCH_HISTORY,
  username = '',
  truncated?: TruncationCollector,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ImportValidationError('搜索历史格式无效');
  }
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  if (value.length > safeLimit) {
    truncated?.add(username, 'searchHistory', value.length - safeLimit);
  }
  return value.slice(0, safeLimit).map((item) => {
    const keyword = limitString(item, '搜索关键词', 191).trim();
    if (!keyword) {
      throw new ImportValidationError('搜索关键词不能为空');
    }
    return keyword;
  });
}

function normalizeSkipConfig(value: unknown): SkipConfig {
  const input = requireObject(value, '跳过配置格式无效');
  return {
    enable: assertBoolean(input.enable, '跳过开关'),
    intro_time: assertBoundedNumber(
      input.intro_time,
      '片头时间',
      0,
      MAX_SECONDS,
    ),
    outro_time: assertBoundedNumber(
      input.outro_time,
      '片尾时间',
      0,
      MAX_SECONDS,
    ),
  };
}

function normalizePlaybackSession(
  value: unknown,
  key: string,
): PlaybackSession {
  const input = requireObject(value, '播放统计格式无效');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(key)) {
    throw new ImportValidationError('播放统计 key 格式无效');
  }

  const startedAt = assertFiniteNumber(input.started_at, '开始时间');
  const endedAt = assertFiniteNumber(input.ended_at, '结束时间');

  return {
    id: key,
    source: limitString(input.source, '视频源', MAX_KEY_LENGTH),
    video_id: limitString(input.video_id, '视频 ID', MAX_KEY_LENGTH),
    episode_index: assertBoundedNumber(input.episode_index, '集数', 0, 10000),
    title: limitString(input.title, '标题', MAX_SHORT_STRING_LENGTH),
    source_name: limitString(
      input.source_name,
      '源名称',
      MAX_SHORT_STRING_LENGTH,
    ),
    cover: limitString(input.cover, '封面', MAX_LONG_STRING_LENGTH),
    year: limitString(input.year, '年份', MAX_SHORT_STRING_LENGTH),
    started_at: startedAt,
    ended_at: Math.max(startedAt, endedAt),
    watch_seconds: assertBoundedNumber(
      input.watch_seconds,
      '观看时长',
      0,
      MAX_SECONDS,
    ),
    last_position: assertBoundedNumber(
      input.last_position,
      '最后进度',
      0,
      MAX_SECONDS,
    ),
    total_time: assertBoundedNumber(input.total_time, '总时长', 0, MAX_SECONDS),
    created_at: assertFiniteNumber(input.created_at, '创建时间'),
    updated_at: assertFiniteNumber(input.updated_at, '更新时间'),
  };
}

function requireObject(value: unknown, message: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImportValidationError(message);
  }
  return value as Record<string, any>;
}

function assertKey(value: unknown, field: string, maxLength: number): void {
  const key = limitString(value, field, maxLength);
  if (!key.trim()) {
    throw new ImportValidationError(`${field} 不能为空`);
  }
}

function limitString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ImportValidationError(`${field}格式无效`);
  }
  if (value.length > maxLength) {
    throw new ImportValidationError(`${field}长度超出限制`, 413);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
  fallback: string,
): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  return limitString(value, field, maxLength);
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ImportValidationError(`${field}格式无效`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ImportValidationError(`${field}格式无效`);
  }
  return value;
}

function assertBoundedNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  const numeric = assertFiniteNumber(value, field);
  if (numeric < min || numeric > max) {
    throw new ImportValidationError(`${field}超出限制`, 413);
  }
  return numeric;
}

function assertStringArray(
  value: unknown,
  field: string,
  maxItemLength: number,
): void {
  if (!Array.isArray(value)) {
    throw new ImportValidationError(`${field}格式无效`);
  }
  for (const item of value) {
    limitString(item, field, maxItemLength);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
