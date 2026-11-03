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

export interface MetadataRecordPage<T> {
  items: Array<{
    key: string;
    item: T;
    // 数据库原始 JSON 快照，用于写回时的乐观并发校验
    snapshot: string;
  }>;
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

// 评价按作品身份（normalizeWorkTitle + normalizeWorkYear）存储，与源站无关
export interface VideoReview {
  title_norm: string;
  year: string;
  title: string;
  cover: string;
  douban_id: number;
  rating: number | null; // 1.0–10.0，最多一位小数；null 表示未评分
  content: string;
  is_public: boolean;
  spoiler?: boolean;
  source_key: string; // 最后编辑时的 source+id
  created_at: number;
  updated_at: number;
}

// 用户资料：登录名只在服务端使用，对外一律用 profile_id + 昵称
export interface UserProfile {
  username: string;
  profile_id: string;
  nickname: string | null;
  avatar_seed: string | null;
  favorites_public: boolean;
  updated_at: number;
}

export interface PublicUserRef {
  profileId: string;
  nickname: string | null;
  // null 时头像按 profileId 生成
  avatarSeed: string | null;
}

export interface UserProfileView extends PublicUserRef {
  isSelf: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  publicReviewCount: number;
  favoritesPublic: boolean;
}

export interface FollowListItem extends PublicUserRef {
  followedAt: number;
}

export interface FollowListPage {
  items: FollowListItem[];
  nextCursor: string | null;
}

export interface PublicFavoriteItem {
  key: string;
  title: string;
  year: string;
  cover: string;
  source_name: string;
  total_episodes: number;
  search_title?: string;
  save_time: number;
}

export type PublicFavoritePage =
  | { hidden: true }
  | { hidden: false; items: PublicFavoriteItem[]; nextCursor: string | null };

export interface PublicVideoReview {
  author: PublicUserRef;
  title_norm: string;
  title: string;
  year: string;
  cover: string;
  rating: number | null;
  content: string;
  spoiler: boolean;
  likeCount: number;
  likedByMe: boolean;
  created_at: number;
  updated_at: number;
}

export interface PublicVideoReviewPage {
  items: PublicVideoReview[];
  nextCursor: string | null;
}

export interface AdminVideoReview extends PublicVideoReview {
  username: string;
}

export interface AdminVideoReviewPage {
  items: AdminVideoReview[];
  nextCursor: string | null;
}

export interface WorkReviewSummary {
  average: number | null;
  count: number;
  // 长度 10，下标 i 统计评分落在 [i+1, i+2) 的人数，10.0 计入下标 9
  distribution: number[];
  reviews: PublicVideoReview[];
}

export const REVIEW_REPORT_REASONS = [
  'spoiler',
  'abuse',
  'spam',
  'illegal',
  'other',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export interface AdminReviewReportItem {
  review: AdminVideoReview;
  reportCount: number;
  reasons: Partial<Record<ReviewReportReason, number>>;
  // 最近 5 条举报
  reports: {
    reporter: PublicUserRef;
    reason: ReviewReportReason;
    detail: string;
    created_at: number;
  }[];
  latestReportedAt: number;
}

export interface AdminReviewReportPage {
  items: AdminReviewReportItem[];
  nextCursor: string | null;
  pendingTotal: number;
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

export type PlaybackPeriodSession = Pick<
  PlaybackSession,
  | 'source'
  | 'video_id'
  | 'title'
  | 'cover'
  | 'year'
  | 'started_at'
  | 'ended_at'
  | 'watch_seconds'
>;

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
  videoReviews?: VideoReview[];
  profile?: UserProfile;
  follows?: { followee: string; created_at: number }[];
  likes?: {
    author: string;
    title_norm: string;
    year: string;
    created_at: number;
  }[];
  reports?: {
    author: string;
    title_norm: string;
    year: string;
    reason: ReviewReportReason;
    detail: string;
    created_at: number;
  }[];
  searchHistory: string[];
  skipConfigs: { [key: string]: SkipConfig };
  playbackSessions: { [key: string]: PlaybackSession };
  messageState?: UserMessageState;
  danmakuEnabled?: boolean;
  lastLoginAt?: number;
}

export interface UserMessageStateUpdate {
  announcement?: { id: string; previousId?: string };
  followReview?: { id: string; createdAt: number };
  followReviewReadAt?: number;
}

export interface UserMessageState {
  readAnnouncementId?: string;
  // 关注动态已读水位，之前的视为已读；水位之后单独已读的消息 id 记在列表里
  followReviewReadAt?: number;
  followReviewReadIds?: string[];
}

export interface StorageImportData {
  adminConfig: AdminConfig;
  users: { [username: string]: string };
  userData: { [username: string]: StorageUserImportData };
  sourceRouteStats: SourceRouteStatsBucket[];
  inviteCodeUsage: { [code: string]: number };
}

export interface SharedCacheRecord {
  value: string;
  freshUntil: number;
  staleUntil: number;
  leaseUntil: number;
}

// 存储接口
export interface IStorage {
  readonly resources: import('@/lib/shared-resource-store').SharedResourceStore;
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void>;
  setPlayRecordIfUnchanged(
    userName: string,
    key: string,
    record: PlayRecord,
    snapshot: string,
  ): Promise<boolean>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  getStalePlayRecordPage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<PlayRecord>>;
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
  setFavoriteIfUnchanged(
    userName: string,
    key: string,
    favorite: Favorite,
    snapshot: string,
  ): Promise<boolean>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  getStaleFavoritePage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<Favorite>>;
  getFavoritePage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<FavoritePage>;
  deleteFavorite(userName: string, key: string): Promise<void>;
  deleteAllFavorites(userName: string): Promise<void>;

  getVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
  ): Promise<VideoReview | null>;
  setVideoReview(userName: string, review: VideoReview): Promise<void>;
  deleteVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
    publicOnly?: boolean,
  ): Promise<void>;
  getAllVideoReviews(userName: string): Promise<VideoReview[]>;
  getPublicVideoReviewsForWork(
    titleNorm: string,
    year: string,
    viewer?: string,
  ): Promise<WorkReviewSummary>;
  getPublicVideoReviewPage(
    cursor?: string,
    q?: string,
  ): Promise<AdminVideoReviewPage>;

  getUserProfile(username: string): Promise<UserProfile | null>;
  getUserProfileById(profileId: string): Promise<UserProfile | null>;
  ensureUserProfile(username: string): Promise<UserProfile>;
  updateUserProfile(
    username: string,
    patch: {
      nickname?: string;
      avatarSeed?: string | null;
      favoritesPublic?: boolean;
    },
  ): Promise<UserProfile>;
  isNicknameAvailable(
    nickname: string,
    exceptUsername?: string,
  ): Promise<boolean>;
  getUserProfileView(
    username: string,
    viewer: string,
  ): Promise<UserProfileView | null>;
  setUserFollow(
    follower: string,
    followee: string,
    following: boolean,
  ): Promise<{ following: boolean; followerCount: number }>;
  getUserFollowPage(
    username: string,
    type: 'followers' | 'following',
    cursor?: string,
  ): Promise<FollowListPage>;
  getUserPublicReviewPage(
    username: string,
    viewer: string,
    cursor?: string,
  ): Promise<PublicVideoReviewPage>;
  setVideoReviewLike(
    author: string,
    titleNorm: string,
    year: string,
    liker: string,
    liked: boolean,
  ): Promise<{ liked: boolean; likeCount: number } | null>;
  reportVideoReview(
    author: string,
    titleNorm: string,
    year: string,
    reporter: string,
    reason: ReviewReportReason,
    detail: string,
  ): Promise<boolean>;
  getReviewReportPage(cursor?: string): Promise<AdminReviewReportPage>;
  moderateReviewReports(
    author: string,
    titleNorm: string,
    year: string,
    action: 'dismiss' | 'mark-spoiler' | 'delete-review',
  ): Promise<void>;
  getFollowReviewMessages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<import('@/lib/message-types').FollowReviewUserMessage[]>;
  getUserSocialData(
    username: string,
  ): Promise<
    Pick<StorageUserImportData, 'profile' | 'follows' | 'likes' | 'reports'>
  >;

  // 用户相关
  registerUser(
    userName: string,
    password: string,
    nickname?: string,
  ): Promise<void>;
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
  updateUserMessageState(
    userName: string,
    update: UserMessageStateUpdate,
  ): Promise<UserMessageState>;

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
  getPlaybackPeriodSessions(
    userName: string,
    start: number,
    end: number,
  ): Promise<PlaybackPeriodSession[]>;
  recordSourceRouteStat(input: SourceRouteStatInput): Promise<void>;
  getSourceRouteStats(sinceDate: string): Promise<SourceRouteStatsItem[]>;
  getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]>;

  getSharedCache(key: string): Promise<SharedCacheRecord | null>;
  acquireSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean>;
  setSharedCache(
    key: string,
    token: string,
    value: string,
    freshUntil: number,
    staleUntil: number,
    now: number,
  ): Promise<boolean>;
  releaseSharedCacheLease(key: string, token: string): Promise<void>;
  renewSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean>;
  pruneSharedCache(now: number, limit: number): Promise<void>;

  // 弹幕集映射相关
  getDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<number | null>;
  setDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
    episodeId: number,
  ): Promise<void>;
  deleteDanmakuEpisodeId(userName: string, scopeKey: string): Promise<void>;
  getDanmakuEnabledPreference(userName: string): Promise<boolean | null>;
  setDanmakuEnabledPreference(
    userName: string,
    enabled: boolean,
  ): Promise<void>;

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
