import {
  type ConfigStateUpdate,
  type ConfigSubscription,
} from '@/lib/config-state';
import type {
  StoredUserDanmaku,
  UserDanmakuQuery,
} from '@/lib/user-danmaku-storage';
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
  series_status?: 'ongoing' | 'ended';
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

export type FavoriteWatchStatus = 'planned' | 'watching' | 'completed';

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
  watch_status?: FavoriteWatchStatus;
  watched_at?: number;
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

export type LibraryVisibility = 0 | 1 | 2 | 3;

// 用户资料：登录名只在服务端使用，对外一律用 profile_id + 昵称
export interface UserProfile {
  username: string;
  profile_id: string;
  nickname: string | null;
  avatar_seed: string | null;
  favorites_public: LibraryVisibility;
  updated_at: number;
}

export interface PublicUserRef {
  profileId: string;
  nickname: string | null;
  // null 时头像按 profileId 生成
  avatarSeed: string | null;
  // 仅站长、管理员返回；普通用户省略
  role?: 'owner' | 'admin';
}

export interface UserProfileView extends PublicUserRef {
  isSelf: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  publicReviewCount: number;
  favoriteCount: number;
  libraryVisibility: LibraryVisibility;
}

export interface FollowListItem extends PublicUserRef {
  followedAt: number;
}

export interface FollowListPage {
  items: FollowListItem[];
  nextCursor: string | null;
}

export interface PublicFavoriteItem {
  watchStatus?: FavoriteWatchStatus;
  rating?: number | null;
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
  | { hidden: true; libraryVisibility: 0 }
  | {
      hidden: false;
      libraryVisibility: LibraryVisibility;
      items: PublicFavoriteItem[];
      nextCursor: string | null;
    };

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
  replyCount: number;
  likedByMe: boolean;
  created_at: number;
  updated_at: number;
}

export interface ReviewTarget {
  profileId: string;
  title_norm: string;
  year: string;
}

export interface PublicReviewReply {
  id: string;
  author: PublicUserRef;
  replyTo: { profileId: string; nickname: string | null } | null;
  content: string;
  created_at: number;
  isMine: boolean;
}
export interface PublicReviewReplyPage {
  items: PublicReviewReply[];
  nextCursor: string | null;
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

export type VideoReviewRating = Pick<
  VideoReview,
  'title_norm' | 'year' | 'rating'
>;
export interface MyVideoReviewPage {
  items: VideoReview[];
  nextCursor: string | null;
  total: number;
  counts: Record<import('@/lib/video-reviews').MyReviewFilter, number>;
}

export interface WorkReviewSummary {
  nextCursor?: string | null;
  reviewCount?: number;
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
  reply?: PublicReviewReply;
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

export interface SourceHealthSearchDelta {
  source: string;
  bucketDate: string;
  okCount: number;
  emptyCount: number;
  errorCount: number;
  latencyMsSum: number;
  latencySamples: number;
}

export type SourceHealthSearchDaily = SourceHealthSearchDelta;

export interface SourcePlayReportInput {
  source: string;
  bucketDate: string;
  reporter: string;
  success: boolean;
}

export interface SourcePlayReporterSummary {
  source: string;
  successReporterDays: number;
  failureReporterDays: number;
  lastSuccessDate: string | null;
}

export type SourceRouteMode = 'browser' | 'server';

// 数据库存储键隔离全程线路口径，API 仍使用 browser / server。
export const SOURCE_ROUTE_STAT_STORAGE_MODES = {
  browser: 'browser-v2',
  server: 'server-v2',
} as const;

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
  routeMode:
    | SourceRouteMode
    | (typeof SOURCE_ROUTE_STAT_STORAGE_MODES)[SourceRouteMode];
  bucketDate: string;
  successCount: number;
  failureCount: number;
}

export interface UserSocialData {
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
  replies?: Omit<
    import('@/lib/review-reply-storage').ReviewReplyRow,
    'username'
  >[];
  replyReports?: {
    reply_id: string;
    reason: ReviewReportReason;
    detail: string;
    created_at: number;
  }[];
}

export interface UserMessageStateUpdate {
  notificationSettings?: {
    mutedKinds: import('@/lib/message-types').MessageNotificationKind[];
    now: number;
  };
  newFollower?: { id: string; createdAt: number };
  newFollowerReadAt?: number;
  reviewLike?: { id: string; createdAt: number };
  reviewLikeReadAt?: number;
  announcement?: { id: string; createdAt: number };
  announcementReadAt?: number;
  followReview?: { id: string; createdAt: number };
  reviewReply?: { id: string; createdAt: number };
  reviewReplyReadAt?: number;
  followReviewReadAt?: number;
}

export interface UserMessageState {
  mutedKinds?: import('@/lib/message-types').MessageNotificationKind[];
  newFollowerReadAt?: number;
  newFollowerReadIds?: string[];
  reviewLikeReadAt?: number;
  reviewLikeReadIds?: string[];
  announcementReadAt?: number;
  announcementReadIds?: string[];
  reviewReplyReadAt?: number;
  reviewReplyReadIds?: string[];
  // 关注动态已读水位，之前的视为已读；水位之后单独已读的消息 id 记在列表里
  followReviewReadAt?: number;
  followReviewReadIds?: string[];
}

export interface SharedCacheRecord {
  value: string;
  freshUntil: number;
  staleUntil: number;
  leaseUntil: number;
}

export interface SiteAnnouncement {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

// 存储接口
export interface IStorage {
  listAnnouncements(limit: number): Promise<SiteAnnouncement[]>;
  countAnnouncements(): Promise<number>;
  getPublishedAnnouncements(options: {
    since?: number;
    before?: { publishedAt: number; id: string };
    limit: number;
  }): Promise<SiteAnnouncement[]>;
  getAnnouncement(id: string): Promise<SiteAnnouncement | null>;
  createAnnouncement(announcement: SiteAnnouncement): Promise<void>;
  updateAnnouncement(
    id: string,
    patch: { content?: string; publishedAt?: number | null; updatedAt: number },
  ): Promise<SiteAnnouncement | null>;
  deleteAnnouncement(id: string): Promise<boolean>;
  addUserDanmaku(item: StoredUserDanmaku): Promise<void>;
  getUserDanmaku(
    episodeKey: string,
    limit: number,
  ): Promise<StoredUserDanmaku[]>;
  getAllUserDanmaku(username: string): Promise<StoredUserDanmaku[]>;
  deleteUserDanmaku(id: string, username?: string): Promise<boolean>;
  getUserDanmakuPage(query: UserDanmakuQuery): Promise<StoredUserDanmaku[]>;
  deleteUserDanmakuBatch(ids: string[]): Promise<number>;
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
    filter?: 'updated',
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
  deletePlayRecords(userName: string, keys: string[]): Promise<void>;
  deleteAllPlayRecords(userName: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  saveMergedFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<string>;
  batchFavorites(
    userName: string,
    input: import('@/features/favorites/lib/library-query').FavoriteBatchInput,
  ): Promise<{ affected: number }>;
  getFavoriteForWork(
    userName: string,
    work: import('@/features/favorites/lib/library-query').FavoriteWorkQuery,
  ): Promise<
    import('@/features/favorites/lib/library-query').FavoriteLibraryItem | null
  >;
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
  getFavoriteLibraryPage(
    userName: string,
    query: import('@/features/favorites/lib/library-query').FavoriteLibraryQuery,
  ): Promise<
    import('@/features/favorites/lib/library-query').FavoriteLibraryPage
  >;
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
  getMyVideoReviewPage(
    userName: string,
    query?: import('@/lib/video-reviews').MyReviewQuery,
  ): Promise<MyVideoReviewPage>;
  getMyVideoReviewCount(userName: string): Promise<number>;
  getMyVideoReviewRatings(userName: string): Promise<VideoReviewRating[]>;
  getWorkVideoReviewPage(
    titleNorm: string,
    year: string,
    viewer: string,
    cursor?: string,
  ): Promise<WorkReviewSummary>;
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
      libraryVisibility?: LibraryVisibility;
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
  getReviewReplies(
    author: string,
    title: string,
    year: string,
    viewer: string,
    cursor?: string,
  ): Promise<PublicReviewReplyPage>;
  postReviewReply(
    author: string,
    title: string,
    year: string,
    username: string,
    content: string,
    replyToId?: string,
  ): Promise<PublicReviewReply | null>;
  deleteReviewReply(
    id: string,
    username: string,
    admin?: boolean,
  ): Promise<boolean>;
  reportReviewReply(
    id: string,
    reporter: string,
    reason: ReviewReportReason,
    detail: string,
  ): Promise<boolean>;
  moderateReplyReports(
    id: string,
    action: 'dismiss' | 'delete-reply',
  ): Promise<void>;
  getReviewReplyMessages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query?: import('@/lib/follow-review-identity').FollowReviewQuery,
  ): Promise<import('@/lib/message-types').ReviewReplyUserMessage[]>;
  getReviewReplyMessageCount(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number>;
  getPublicReview(
    target: ReviewTarget,
    viewer: string,
  ): Promise<PublicVideoReview | null>;
  getSocialNotifications(
    kind: import('@/lib/social-notification-identity').SocialNotificationKind,
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query?: import('@/lib/follow-review-identity').FollowReviewQuery,
  ): Promise<
    (
      | import('@/lib/message-types').NewFollowerUserMessage
      | import('@/lib/message-types').ReviewLikeUserMessage
    )[]
  >;
  getSocialNotificationCount(
    kind: import('@/lib/social-notification-identity').SocialNotificationKind,
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number>;
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
    query?: import('@/lib/follow-review-identity').FollowReviewQuery,
  ): Promise<import('@/lib/message-types').FollowReviewUserMessage[]>;
  getFollowReviewMessageCount(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number>;
  getUserSocialData(username: string): Promise<UserSocialData>;

  // 用户相关
  getOAuthIdentity(
    providerUserId: string,
  ): Promise<import('@/lib/oauth-identity').OAuthIdentity | null>;
  getUserOAuthIdentity(
    username: string,
  ): Promise<import('@/lib/oauth-identity').OAuthIdentity | null>;
  bindOAuthIdentity(
    identity: import('@/lib/oauth-identity').OAuthIdentity,
  ): Promise<import('@/lib/oauth-identity').OAuthBindResult>;
  unbindOAuthIdentity(username: string): Promise<boolean>;
  updateOAuthProviderUsername(
    providerUserId: string,
    providerUsername: string,
  ): Promise<void>;
  registerUser(
    userName: string,
    password: string,
    nickname?: string,
    userGroups?: string[],
    identity?: import('@/lib/oauth-identity').OAuthIdentity,
  ): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(
    userName: string,
    guard?: import('@/lib/user-access').UserAccessGuard,
  ): Promise<void>;
  getUserAccess(
    username: string,
  ): Promise<import('@/lib/user-access').UserAccess | null>;
  updateUserAccess(
    usernames: string[],
    patch: import('@/lib/user-access').UserAccessPatch,
    guard?: import('@/lib/user-access').UserAccessGuard,
  ): Promise<number>;
  removeUserGroup(group: string): Promise<void>;
  removeUserSource(source: string): Promise<void>;
  deleteUserIfInactive(
    userName: string,
    before: number,
    operatorUsername: string,
  ): Promise<boolean>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(
    userName: string,
    keyword: string,
    limit?: number,
  ): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAdminUserPage(
    query: import('@/features/admin/services/userQueryStorage').AdminUserStorageQuery,
  ): Promise<import('@/features/admin/lib/user-query').AdminUserPage>;
  getConfigSubscription(): Promise<ConfigSubscription>;
  getLiveSourceChannelCounts(): Promise<Record<string, number>>;
  setLiveSourceChannelCount(
    source: NonNullable<AdminConfig['LiveConfig']>[number],
    count: number,
  ): Promise<void>;
  compareAndSetAdminConfig(
    expected: AdminConfig | null,
    config: AdminConfig,
    state?: ConfigStateUpdate,
  ): Promise<boolean>;
  getAllUsers(): Promise<string[]>;

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

  getAllInviteCodes(): Promise<
    import('@/features/admin/services/inviteCodes').InviteCode[]
  >;
  queryInviteCodes(
    query: import('@/lib/invite-code-storage').InviteCodeQuery,
  ): Promise<import('@/lib/invite-code-storage').InviteCodePage>;
  countInviteCodes(): Promise<number>;
  countActiveInviteCodes(): Promise<number>;
  createInviteCodes(
    items: import('@/features/admin/services/inviteCodes').InviteCode[],
  ): Promise<import('@/lib/invite-code-storage').InviteCodeCreateResult>;
  createInviteCode(
    item: import('@/features/admin/services/inviteCodes').InviteCode,
  ): Promise<import('@/lib/invite-code-storage').InviteCodeCreateResult>;
  deleteInviteCode(code: string): Promise<boolean>;
  // 删除到期时间不晚于 expiredBefore 的邀请码，可选连同已用尽的一起删除，返回删除条数
  purgeInviteCodes(
    options: import('@/lib/invite-code-storage').InviteCodePurge,
  ): Promise<number>;
  reserveInviteCodeUse(code: string): Promise<boolean>;
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
  recordSourceHealthSearchBatch(rows: SourceHealthSearchDelta[]): Promise<void>;
  recordSourcePlayReport(input: SourcePlayReportInput): Promise<void>;
  getSourceHealthSearchDaily(
    sinceDate: string,
  ): Promise<SourceHealthSearchDaily[]>;
  getSourcePlayReporterSummary(
    sinceDate: string,
  ): Promise<SourcePlayReporterSummary[]>;
  purgeSourceHealthBefore(beforeDate: string): Promise<void>;

  recordSourceRouteStat(input: SourceRouteStatInput): Promise<void>;
  getSourceRouteStats(sinceDate: string): Promise<SourceRouteStatsItem[]>;
  getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]>;
  purgeSourceRouteStatsBefore(beforeDate: string): Promise<void>;

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
  series_status?: 'ongoing' | 'ended';
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
