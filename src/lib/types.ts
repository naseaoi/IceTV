import { AdminConfig } from '@/types/admin';

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  group_index?: number; // 分组源：组内第几集（1-based）
  group_total?: number; // 分组源：当前组集数
  group_label?: string; // 分组源：所属分组标签，用于上游更新后重新对齐集索引
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  metadata_checked_at?: number;
  update_baseline_episodes?: number;
  update_baseline_group_total?: number;
  update_detected_at?: number;
  tracking_enabled?: boolean;
  search_title?: string; // 搜索时使用的标题
}

export interface PlayRecordPage {
  items: Record<string, PlayRecord>;
  total: number;
  nextCursor: string | null;
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  metadata_checked_at?: number;
  search_title?: string; // 搜索时使用的标题
  origin?: 'vod' | 'live';
}

export interface FavoritePageItem {
  key: string;
  favorite: Favorite;
  playRecord?: PlayRecord;
}

export interface FavoritePage {
  items: FavoritePageItem[];
  total: number;
  nextCursor: string | null;
}

export interface PlaybackSession {
  id: string;
  source: string;
  video_id: string;
  episode_index: number;
  title: string;
  source_name: string;
  cover: string;
  year: string;
  started_at: number;
  ended_at: number;
  watch_seconds: number;
  last_position: number;
  total_time: number;
  created_at: number;
  updated_at: number;
}

export interface PlaybackSessionQuery {
  since?: number;
  limit?: number;
  cursor?: number;
  keyword?: string;
}

export interface PlaybackWatchTotals {
  totalWatchSeconds: number;
  periodWatchSeconds: number;
}

export interface PlaybackTimeRange {
  key: string;
  start: number;
  end: number;
}

export interface PlaybackRangeWatchTotal {
  key: string;
  watchSeconds: number;
}

export interface PlaybackStatsTopItem {
  source: string;
  videoId: string;
  title: string;
  sourceName: string;
  cover: string;
  year: string;
  watchSeconds: number;
  sessionCount: number;
  lastWatchedAt: number;
}

export type SourceRouteMode = 'browser' | 'server';

export interface SourceRouteStatInput {
  source: string;
  routeMode: SourceRouteMode;
  success: boolean;
  eventAt: number;
}

export interface SourceRouteStatsItem {
  source: string;
  routeMode: SourceRouteMode;
  successCount: number;
  failureCount: number;
}

// 源站路由统计原始行（按天粒度）
export interface SourceRouteStatsBucket {
  source: string;
  routeMode: SourceRouteMode;
  bucketDate: string;
  successCount: number;
  failureCount: number;
}

export interface StorageUserImportData {
  playRecords: { [key: string]: PlayRecord };
  favorites: { [key: string]: Favorite };
  searchHistory: string[];
  skipConfigs: { [key: string]: SkipConfig };
  playbackSessions: { [key: string]: PlaybackSession };
  messageState?: UserMessageState;
  lastLoginAt?: number;
}

export interface UserMessageState {
  readAnnouncementId?: string;
}

export interface StorageImportData {
  adminConfig: AdminConfig;
  users: { [username: string]: string };
  userData: { [username: string]: StorageUserImportData };
  sourceRouteStats: SourceRouteStatsBucket[];
}

// 存储接口
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  getPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage>;
  getUnreadTrackingPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage>;
  setPlayRecords(
    userName: string,
    records: Record<string, PlayRecord>,
  ): Promise<void>;
  deletePlayRecord(userName: string, key: string): Promise<void>;
  deleteAllPlayRecords(userName: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  getFavoritePage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<FavoritePage>;
  deleteFavorite(userName: string, key: string): Promise<void>;
  deleteAllFavorites(userName: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(
    userName: string,
    keyword: string,
    limit?: number,
  ): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;
  getAllUsersWithPasswords(): Promise<{ [username: string]: string }>;

  getUserMessageState(userName: string): Promise<UserMessageState>;
  setUserMessageState(userName: string, state: UserMessageState): Promise<void>;

  // 登录活动相关
  recordUserLogin(userName: string, loginAt: number): Promise<void>;
  getUserLastLogin(userName: string): Promise<number | null>;
  getAllUserLastLogins(): Promise<Record<string, number>>;

  // 邀请码用量相关，与配置分离以支持并发注册
  reserveInviteCodeUse(
    code: string,
    maxUses: number,
    seedCount?: number,
  ): Promise<boolean>;
  releaseInviteCodeUse(code: string): Promise<void>;
  getAllInviteCodeUsage(): Promise<Record<string, number>>;
  deleteInviteCodeUsage(code: string): Promise<void>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 跳过片头片尾配置相关
  getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  setPlaybackSession(userName: string, session: PlaybackSession): Promise<void>;
  getPlaybackSessions(
    userName: string,
    query?: PlaybackSessionQuery,
  ): Promise<PlaybackSession[]>;
  getAllPlaybackSessions(userName: string): Promise<PlaybackSession[]>;
  deletePlaybackSession(userName: string, id: string): Promise<void>;
  deletePlaybackSessionsBefore(updatedBefore: number): Promise<number>;
  getPlaybackWatchTotals(
    userName: string,
    since: number,
  ): Promise<PlaybackWatchTotals>;
  getPlaybackRangeWatchTotals(
    userName: string,
    ranges: PlaybackTimeRange[],
  ): Promise<PlaybackRangeWatchTotal[]>;
  getPlaybackTopItems(
    userName: string,
    limit?: number,
    since?: number,
  ): Promise<PlaybackStatsTopItem[]>;
  recordSourceRouteStat(input: SourceRouteStatInput): Promise<void>;
  getSourceRouteStats(sinceDate: string): Promise<SourceRouteStatsItem[]>;
  getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]>;

  // 数据清理相关
  clearAllData(): Promise<void>;
  replaceAllData(data: StorageImportData): Promise<void>;
}

// 搜索结果数据结构
export interface EpisodeGroup {
  label: string;
  count: number;
}

export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  episodes_titles: string[];
  source: string;
  source_name: string;
  variant_label?: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
  related_sources?: SearchResult[];
  episode_groups?: EpisodeGroup[];
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳过片头片尾配置数据结构
export interface SkipConfig {
  enable: boolean; // 是否启用跳过片头片尾
  intro_time: number; // 片头时间（秒）
  outro_time: number; // 片尾时间（秒）
}
