import 'server-only';

import { AdminConfig } from '@/types/admin';

import { getStorageType } from './storage-type';
import {
  AdminVideoReviewPage,
  Favorite,
  IStorage,
  MetadataRecordPage,
  PlaybackPeriodSession,
  PlaybackSession,
  PlaybackSessionQuery,
  PlaybackWatchTotals,
  PlayRecord,
  PlayRecordPage,
  SharedCacheRecord,
  SkipConfig,
  SourceHealthSearchDaily,
  SourceHealthSearchDelta,
  SourcePlayReporterSummary,
  SourcePlayReportInput,
  SourceRouteStatInput,
  SourceRouteStatsBucket,
  SourceRouteStatsItem,
  UserMessageState,
  VideoReview,
  WorkReviewSummary,
} from './types';

async function createStorage(): Promise<IStorage> {
  const storageType = getStorageType();

  if (storageType === 'mysql') {
    const { MySqlStorage } = await import('@/lib/mysql.db');
    return new MySqlStorage();
  }

  const { LocalSqliteStorage } = await import('@/lib/sqlite.db');
  return new LocalSqliteStorage();
}

let storageInstancePromise: Promise<IStorage> | null = null;

async function getStorage(): Promise<IStorage> {
  if (!storageInstancePromise) {
    storageInstancePromise = createStorage().catch((error) => {
      storageInstancePromise = null;
      throw error;
    });
  }
  return storageInstancePromise;
}

// 工具函数：生成存储key
function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
class DbManager {
  private async getStorage(): Promise<IStorage> {
    return getStorage();
  }

  async getUserProfile(
    ...args: Parameters<IStorage['getUserProfile']>
  ): ReturnType<IStorage['getUserProfile']> {
    return (await this.getStorage()).getUserProfile(...args);
  }

  async getUserProfileById(
    ...args: Parameters<IStorage['getUserProfileById']>
  ): ReturnType<IStorage['getUserProfileById']> {
    return (await this.getStorage()).getUserProfileById(...args);
  }

  async ensureUserProfile(
    ...args: Parameters<IStorage['ensureUserProfile']>
  ): ReturnType<IStorage['ensureUserProfile']> {
    return (await this.getStorage()).ensureUserProfile(...args);
  }

  async updateUserProfile(
    ...args: Parameters<IStorage['updateUserProfile']>
  ): ReturnType<IStorage['updateUserProfile']> {
    return (await this.getStorage()).updateUserProfile(...args);
  }

  async isNicknameAvailable(
    ...args: Parameters<IStorage['isNicknameAvailable']>
  ): ReturnType<IStorage['isNicknameAvailable']> {
    return (await this.getStorage()).isNicknameAvailable(...args);
  }

  async getUserProfileView(
    ...args: Parameters<IStorage['getUserProfileView']>
  ): ReturnType<IStorage['getUserProfileView']> {
    return (await this.getStorage()).getUserProfileView(...args);
  }

  async setUserFollow(
    ...args: Parameters<IStorage['setUserFollow']>
  ): ReturnType<IStorage['setUserFollow']> {
    return (await this.getStorage()).setUserFollow(...args);
  }

  async getUserFollowPage(
    ...args: Parameters<IStorage['getUserFollowPage']>
  ): ReturnType<IStorage['getUserFollowPage']> {
    return (await this.getStorage()).getUserFollowPage(...args);
  }

  async getUserPublicReviewPage(
    ...args: Parameters<IStorage['getUserPublicReviewPage']>
  ): ReturnType<IStorage['getUserPublicReviewPage']> {
    return (await this.getStorage()).getUserPublicReviewPage(...args);
  }

  async setVideoReviewLike(
    ...args: Parameters<IStorage['setVideoReviewLike']>
  ): ReturnType<IStorage['setVideoReviewLike']> {
    return (await this.getStorage()).setVideoReviewLike(...args);
  }

  async reportVideoReview(
    ...args: Parameters<IStorage['reportVideoReview']>
  ): ReturnType<IStorage['reportVideoReview']> {
    return (await this.getStorage()).reportVideoReview(...args);
  }

  async getReviewReportPage(
    ...args: Parameters<IStorage['getReviewReportPage']>
  ): ReturnType<IStorage['getReviewReportPage']> {
    return (await this.getStorage()).getReviewReportPage(...args);
  }

  async getFollowReviewMessageCount(
    ...args: Parameters<IStorage['getFollowReviewMessageCount']>
  ): Promise<number> {
    return (await this.getStorage()).getFollowReviewMessageCount(...args);
  }

  async getFollowReviewMessages(
    ...args: Parameters<IStorage['getFollowReviewMessages']>
  ): ReturnType<IStorage['getFollowReviewMessages']> {
    return (await this.getStorage()).getFollowReviewMessages(...args);
  }

  async getReviewReplies(
    ...args: Parameters<IStorage['getReviewReplies']>
  ): ReturnType<IStorage['getReviewReplies']> {
    return (await this.getStorage()).getReviewReplies(...args);
  }

  async postReviewReply(
    ...args: Parameters<IStorage['postReviewReply']>
  ): ReturnType<IStorage['postReviewReply']> {
    return (await this.getStorage()).postReviewReply(...args);
  }

  async reportReviewReply(
    ...args: Parameters<IStorage['reportReviewReply']>
  ): ReturnType<IStorage['reportReviewReply']> {
    return (await this.getStorage()).reportReviewReply(...args);
  }

  async getReviewReplyMessages(
    ...args: Parameters<IStorage['getReviewReplyMessages']>
  ): ReturnType<IStorage['getReviewReplyMessages']> {
    return (await this.getStorage()).getReviewReplyMessages(...args);
  }

  async getReviewReplyMessageCount(
    ...args: Parameters<IStorage['getReviewReplyMessageCount']>
  ): ReturnType<IStorage['getReviewReplyMessageCount']> {
    return (await this.getStorage()).getReviewReplyMessageCount(...args);
  }

  async deleteReviewReply(
    ...args: Parameters<IStorage['deleteReviewReply']>
  ): ReturnType<IStorage['deleteReviewReply']> {
    return (await this.getStorage()).deleteReviewReply(...args);
  }

  async moderateReplyReports(
    ...args: Parameters<IStorage['moderateReplyReports']>
  ): ReturnType<IStorage['moderateReplyReports']> {
    return (await this.getStorage()).moderateReplyReports(...args);
  }

  async getPublicReview(
    ...args: Parameters<IStorage['getPublicReview']>
  ): ReturnType<IStorage['getPublicReview']> {
    return (await this.getStorage()).getPublicReview(...args);
  }

  async getSocialNotifications(
    ...args: Parameters<IStorage['getSocialNotifications']>
  ): ReturnType<IStorage['getSocialNotifications']> {
    return (await this.getStorage()).getSocialNotifications(...args);
  }

  async getSocialNotificationCount(
    ...args: Parameters<IStorage['getSocialNotificationCount']>
  ): ReturnType<IStorage['getSocialNotificationCount']> {
    return (await this.getStorage()).getSocialNotificationCount(...args);
  }

  async getUserSocialData(
    ...args: Parameters<IStorage['getUserSocialData']>
  ): ReturnType<IStorage['getUserSocialData']> {
    return (await this.getStorage()).getUserSocialData(...args);
  }

  async moderateReviewReports(
    ...args: Parameters<IStorage['moderateReviewReports']>
  ): ReturnType<IStorage['moderateReviewReports']> {
    return (await this.getStorage()).moderateReviewReports(...args);
  }

  async addUserDanmaku(
    ...args: Parameters<IStorage['addUserDanmaku']>
  ): ReturnType<IStorage['addUserDanmaku']> {
    return (await this.getStorage()).addUserDanmaku(...args);
  }

  async getUserDanmaku(
    ...args: Parameters<IStorage['getUserDanmaku']>
  ): ReturnType<IStorage['getUserDanmaku']> {
    return (await this.getStorage()).getUserDanmaku(...args);
  }

  async getAllUserDanmaku(
    ...args: Parameters<IStorage['getAllUserDanmaku']>
  ): ReturnType<IStorage['getAllUserDanmaku']> {
    return (await this.getStorage()).getAllUserDanmaku(...args);
  }

  async deleteUserDanmaku(
    ...args: Parameters<IStorage['deleteUserDanmaku']>
  ): ReturnType<IStorage['deleteUserDanmaku']> {
    return (await this.getStorage()).deleteUserDanmaku(...args);
  }

  async getUserDanmakuPage(
    ...args: Parameters<IStorage['getUserDanmakuPage']>
  ): ReturnType<IStorage['getUserDanmakuPage']> {
    return (await this.getStorage()).getUserDanmakuPage(...args);
  }

  async deleteUserDanmakuBatch(
    ...args: Parameters<IStorage['deleteUserDanmakuBatch']>
  ): ReturnType<IStorage['deleteUserDanmakuBatch']> {
    return (await this.getStorage()).deleteUserDanmakuBatch(...args);
  }

  async getVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
  ): Promise<VideoReview | null> {
    return (await this.getStorage()).getVideoReview(userName, titleNorm, year);
  }

  async setVideoReview(userName: string, review: VideoReview): Promise<void> {
    return (await this.getStorage()).setVideoReview(userName, review);
  }

  async deleteVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
    publicOnly = false,
  ): Promise<void> {
    return (await this.getStorage()).deleteVideoReview(
      userName,
      titleNorm,
      year,
      publicOnly,
    );
  }

  async getMyVideoReviewPage(
    ...args: Parameters<IStorage['getMyVideoReviewPage']>
  ): ReturnType<IStorage['getMyVideoReviewPage']> {
    return (await this.getStorage()).getMyVideoReviewPage(...args);
  }
  async getMyVideoReviewCount(
    ...args: Parameters<IStorage['getMyVideoReviewCount']>
  ): ReturnType<IStorage['getMyVideoReviewCount']> {
    return (await this.getStorage()).getMyVideoReviewCount(...args);
  }
  async getMyVideoReviewRatings(
    ...args: Parameters<IStorage['getMyVideoReviewRatings']>
  ): ReturnType<IStorage['getMyVideoReviewRatings']> {
    return (await this.getStorage()).getMyVideoReviewRatings(...args);
  }
  async getWorkVideoReviewPage(
    ...args: Parameters<IStorage['getWorkVideoReviewPage']>
  ): ReturnType<IStorage['getWorkVideoReviewPage']> {
    return (await this.getStorage()).getWorkVideoReviewPage(...args);
  }

  async getAllVideoReviews(userName: string): Promise<VideoReview[]> {
    return (await this.getStorage()).getAllVideoReviews(userName);
  }

  async getPublicVideoReviewsForWork(
    titleNorm: string,
    year: string,
    viewer = '',
  ): Promise<WorkReviewSummary> {
    return (await this.getStorage()).getPublicVideoReviewsForWork(
      titleNorm,
      year,
      viewer,
    );
  }

  async getPublicVideoReviewPage(
    cursor?: string,
    q?: string,
  ): Promise<AdminVideoReviewPage> {
    return (await this.getStorage()).getPublicVideoReviewPage(cursor, q);
  }

  async getPlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    return storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    await storage.setPlayRecord(userName, key, record);
  }

  async savePlayRecordIfUnchanged(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord,
    snapshot: string,
  ): Promise<boolean> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    return storage.setPlayRecordIfUnchanged(userName, key, record, snapshot);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    const storage = await this.getStorage();
    return storage.getAllPlayRecords(userName);
  }

  async getStalePlayRecordPage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<PlayRecord>> {
    const storage = await this.getStorage();
    return storage.getStalePlayRecordPage(
      userName,
      now,
      ttlMs,
      limit,
      cursorKey,
    );
  }

  async getPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage> {
    const storage = await this.getStorage();
    return storage.getPlayRecordPage(userName, limit, cursorTime, cursorKey);
  }

  async getUnreadTrackingPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage> {
    const storage = await this.getStorage();
    return storage.getUnreadTrackingPlayRecordPage(
      userName,
      limit,
      cursorTime,
      cursorKey,
    );
  }

  async savePlayRecordsByKey(
    userName: string,
    records: Record<string, PlayRecord>,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setPlayRecords(userName, records);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    await storage.deletePlayRecord(userName, key);
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteAllPlayRecords(userName);
  }

  async getFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    return storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite,
  ): Promise<string> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    return storage.saveMergedFavorite(userName, key, favorite);
  }

  async batchFavorites(...args: Parameters<IStorage['batchFavorites']>) {
    return (await this.getStorage()).batchFavorites(...args);
  }

  async getFavoriteForWork(
    ...args: Parameters<IStorage['getFavoriteForWork']>
  ) {
    return (await this.getStorage()).getFavoriteForWork(...args);
  }

  async saveFavoriteIfUnchanged(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite,
    snapshot: string,
  ): Promise<boolean> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    return storage.setFavoriteIfUnchanged(userName, key, favorite, snapshot);
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    const storage = await this.getStorage();
    return storage.getAllFavorites(userName);
  }

  async getStaleFavoritePage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<Favorite>> {
    const storage = await this.getStorage();
    return storage.getStaleFavoritePage(userName, now, ttlMs, limit, cursorKey);
  }

  async getFavoritePage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
    includeLive = true,
  ) {
    const storage = await this.getStorage();
    return storage.getFavoritePage(
      userName,
      limit,
      cursorTime,
      cursorKey,
      includeLive,
    );
  }

  async getFavoriteLibraryPage(
    ...args: Parameters<IStorage['getFavoriteLibraryPage']>
  ) {
    const storage = await this.getStorage();
    return storage.getFavoriteLibraryPage(...args);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    await storage.deleteFavorite(userName, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteAllFavorites(userName);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string,
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  async getOAuthIdentity(...args: Parameters<IStorage['getOAuthIdentity']>) {
    return (await this.getStorage()).getOAuthIdentity(...args);
  }

  async getUserOAuthIdentity(
    ...args: Parameters<IStorage['getUserOAuthIdentity']>
  ) {
    return (await this.getStorage()).getUserOAuthIdentity(...args);
  }

  async bindOAuthIdentity(...args: Parameters<IStorage['bindOAuthIdentity']>) {
    return (await this.getStorage()).bindOAuthIdentity(...args);
  }

  async unbindOAuthIdentity(
    ...args: Parameters<IStorage['unbindOAuthIdentity']>
  ) {
    return (await this.getStorage()).unbindOAuthIdentity(...args);
  }

  async updateOAuthProviderUsername(
    ...args: Parameters<IStorage['updateOAuthProviderUsername']>
  ) {
    return (await this.getStorage()).updateOAuthProviderUsername(...args);
  }

  async registerUser(
    userName: string,
    password: string,
    nickname?: string,
    userGroups?: string[],
    identity?: import('@/lib/oauth-identity').OAuthIdentity,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.registerUser(
      userName,
      password,
      nickname,
      userGroups,
      identity,
    );
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const storage = await this.getStorage();
    return storage.verifyUser(userName, password);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const storage = await this.getStorage();
    return storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.changePassword(userName, newPassword);
  }

  async getUserAccess(...args: Parameters<IStorage['getUserAccess']>) {
    return (await this.getStorage()).getUserAccess(...args);
  }

  async updateUserAccess(...args: Parameters<IStorage['updateUserAccess']>) {
    return (await this.getStorage()).updateUserAccess(...args);
  }

  async removeUserGroup(group: string) {
    return (await this.getStorage()).removeUserGroup(group);
  }

  async removeUserSource(source: string) {
    return (await this.getStorage()).removeUserSource(source);
  }

  async deleteUserIfInactive(
    ...args: Parameters<IStorage['deleteUserIfInactive']>
  ): Promise<boolean> {
    return (await this.getStorage()).deleteUserIfInactive(...args);
  }

  async deleteUser(...args: Parameters<IStorage['deleteUser']>): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteUser(...args);
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const storage = await this.getStorage();
    return storage.getSearchHistory(userName);
  }

  async addSearchHistory(
    userName: string,
    keyword: string,
    limit?: number,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.addSearchHistory(userName, keyword, limit);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteSearchHistory(userName, keyword);
  }

  async getAdminUserPage(
    ...args: Parameters<IStorage['getAdminUserPage']>
  ): ReturnType<IStorage['getAdminUserPage']> {
    return (await this.getStorage()).getAdminUserPage(...args);
  }

  async getConfigSubscription(
    ...args: Parameters<IStorage['getConfigSubscription']>
  ): ReturnType<IStorage['getConfigSubscription']> {
    return (await this.getStorage()).getConfigSubscription(...args);
  }

  async getLiveSourceChannelCounts(
    ...args: Parameters<IStorage['getLiveSourceChannelCounts']>
  ): ReturnType<IStorage['getLiveSourceChannelCounts']> {
    return (await this.getStorage()).getLiveSourceChannelCounts(...args);
  }

  async setLiveSourceChannelCount(
    ...args: Parameters<IStorage['setLiveSourceChannelCount']>
  ): ReturnType<IStorage['setLiveSourceChannelCount']> {
    return (await this.getStorage()).setLiveSourceChannelCount(...args);
  }

  async compareAndSetAdminConfig(
    ...args: Parameters<IStorage['compareAndSetAdminConfig']>
  ): Promise<boolean> {
    return (await this.getStorage()).compareAndSetAdminConfig(...args);
  }

  async getAllUsers(): Promise<string[]> {
    const storage = await this.getStorage();
    return storage.getAllUsers();
  }

  async recordUserActivity(userName: string, activeAt: number): Promise<void> {
    const storage = await this.getStorage();
    await storage.recordUserLogin(userName, activeAt);
  }

  async getAllUserLastActive(): Promise<Record<string, number>> {
    const storage = await this.getStorage();
    return storage.getAllUserLastLogins();
  }

  async listAnnouncements(
    ...args: Parameters<IStorage['listAnnouncements']>
  ): ReturnType<IStorage['listAnnouncements']> {
    return (await this.getStorage()).listAnnouncements(...args);
  }

  async countAnnouncements(): ReturnType<IStorage['countAnnouncements']> {
    return (await this.getStorage()).countAnnouncements();
  }

  async getPublishedAnnouncements(
    ...args: Parameters<IStorage['getPublishedAnnouncements']>
  ): ReturnType<IStorage['getPublishedAnnouncements']> {
    return (await this.getStorage()).getPublishedAnnouncements(...args);
  }

  async getAnnouncement(
    ...args: Parameters<IStorage['getAnnouncement']>
  ): ReturnType<IStorage['getAnnouncement']> {
    return (await this.getStorage()).getAnnouncement(...args);
  }

  async createAnnouncement(
    ...args: Parameters<IStorage['createAnnouncement']>
  ): ReturnType<IStorage['createAnnouncement']> {
    return (await this.getStorage()).createAnnouncement(...args);
  }

  async updateAnnouncement(
    ...args: Parameters<IStorage['updateAnnouncement']>
  ): ReturnType<IStorage['updateAnnouncement']> {
    return (await this.getStorage()).updateAnnouncement(...args);
  }

  async deleteAnnouncement(
    ...args: Parameters<IStorage['deleteAnnouncement']>
  ): ReturnType<IStorage['deleteAnnouncement']> {
    return (await this.getStorage()).deleteAnnouncement(...args);
  }

  async getAllInviteCodes(): ReturnType<IStorage['getAllInviteCodes']> {
    return (await this.getStorage()).getAllInviteCodes();
  }

  async queryInviteCodes(
    ...args: Parameters<IStorage['queryInviteCodes']>
  ): ReturnType<IStorage['queryInviteCodes']> {
    return (await this.getStorage()).queryInviteCodes(...args);
  }

  async countInviteCodes(): Promise<number> {
    return (await this.getStorage()).countInviteCodes();
  }

  async countActiveInviteCodes(): Promise<number> {
    return (await this.getStorage()).countActiveInviteCodes();
  }

  async createInviteCodes(
    ...args: Parameters<IStorage['createInviteCodes']>
  ): ReturnType<IStorage['createInviteCodes']> {
    return (await this.getStorage()).createInviteCodes(...args);
  }

  async createInviteCode(
    ...args: Parameters<IStorage['createInviteCode']>
  ): ReturnType<IStorage['createInviteCode']> {
    return (await this.getStorage()).createInviteCode(...args);
  }

  async deleteInviteCode(code: string): Promise<boolean> {
    return (await this.getStorage()).deleteInviteCode(code);
  }

  async purgeInviteCodes(
    ...args: Parameters<IStorage['purgeInviteCodes']>
  ): ReturnType<IStorage['purgeInviteCodes']> {
    return (await this.getStorage()).purgeInviteCodes(...args);
  }

  async reserveInviteCodeUse(code: string): Promise<boolean> {
    return (await this.getStorage()).reserveInviteCodeUse(code);
  }

  async releaseInviteCodeUse(code: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.releaseInviteCodeUse(code);
  }

  async getAllInviteCodeUsage(): Promise<Record<string, number>> {
    const storage = await this.getStorage();
    return storage.getAllInviteCodeUsage();
  }

  async deleteInviteCodeUsage(code: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteInviteCodeUsage(code);
  }

  async getUserMessageState(userName: string): Promise<UserMessageState> {
    const storage = await this.getStorage();
    return storage.getUserMessageState(userName);
  }

  async updateUserMessageState(
    ...args: Parameters<IStorage['updateUserMessageState']>
  ): ReturnType<IStorage['updateUserMessageState']> {
    return (await this.getStorage()).updateUserMessageState(...args);
  }

  async setUserMessageState(
    userName: string,
    state: UserMessageState,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setUserMessageState(userName, state);
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const storage = await this.getStorage();
    return storage.getAdminConfig();
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    const storage = await this.getStorage();
    await storage.setAdminConfig(config);
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const storage = await this.getStorage();
    return storage.getSkipConfig(userName, source, id);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setSkipConfig(userName, source, id, config);
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteSkipConfig(userName, source, id);
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    const storage = await this.getStorage();
    return storage.getAllSkipConfigs(userName);
  }

  async getDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<number | null> {
    const storage = await this.getStorage();
    return storage.getDanmakuEpisodeId(userName, scopeKey);
  }

  async setDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
    episodeId: number,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setDanmakuEpisodeId(userName, scopeKey, episodeId);
  }

  async deleteDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteDanmakuEpisodeId(userName, scopeKey);
  }

  async getDanmakuEnabledPreference(userName: string): Promise<boolean | null> {
    const storage = await this.getStorage();
    return storage.getDanmakuEnabledPreference(userName);
  }

  async setDanmakuEnabledPreference(
    userName: string,
    enabled: boolean,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setDanmakuEnabledPreference(userName, enabled);
  }

  async savePlaybackSession(
    userName: string,
    session: PlaybackSession,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setPlaybackSession(userName, session);
  }

  async getPlaybackSessions(
    userName: string,
    query?: PlaybackSessionQuery,
  ): Promise<PlaybackSession[]> {
    const storage = await this.getStorage();
    return storage.getPlaybackSessions(userName, query);
  }

  async getAllPlaybackSessions(userName: string): Promise<PlaybackSession[]> {
    const storage = await this.getStorage();
    return storage.getAllPlaybackSessions(userName);
  }

  async deletePlaybackSession(userName: string, id: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deletePlaybackSession(userName, id);
  }

  async deletePlaybackSessionsBefore(updatedBefore: number): Promise<number> {
    const storage = await this.getStorage();
    return storage.deletePlaybackSessionsBefore(updatedBefore);
  }

  async getPlaybackWatchTotals(
    userName: string,
    since: number,
  ): Promise<PlaybackWatchTotals> {
    const storage = await this.getStorage();
    return storage.getPlaybackWatchTotals(userName, since);
  }

  async getPlaybackPeriodSessions(
    userName: string,
    start: number,
    end: number,
  ): Promise<PlaybackPeriodSession[]> {
    const storage = await this.getStorage();
    return storage.getPlaybackPeriodSessions(userName, start, end);
  }

  async recordSourceHealthSearchBatch(
    rows: SourceHealthSearchDelta[],
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.recordSourceHealthSearchBatch(rows);
  }

  async recordSourcePlayReport(input: SourcePlayReportInput): Promise<void> {
    const storage = await this.getStorage();
    await storage.recordSourcePlayReport(input);
  }

  async getSourceHealthSearchDaily(
    sinceDate: string,
  ): Promise<SourceHealthSearchDaily[]> {
    const storage = await this.getStorage();
    return storage.getSourceHealthSearchDaily(sinceDate);
  }

  async getSourcePlayReporterSummary(
    sinceDate: string,
  ): Promise<SourcePlayReporterSummary[]> {
    const storage = await this.getStorage();
    return storage.getSourcePlayReporterSummary(sinceDate);
  }

  async purgeSourceHealthBefore(beforeDate: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.purgeSourceHealthBefore(beforeDate);
  }

  async recordSourceRouteStat(input: SourceRouteStatInput): Promise<void> {
    const storage = await this.getStorage();
    await storage.recordSourceRouteStat(input);
  }

  async getSourceRouteStats(
    sinceDate: string,
  ): Promise<SourceRouteStatsItem[]> {
    const storage = await this.getStorage();
    return storage.getSourceRouteStats(sinceDate);
  }

  async purgeSourceRouteStatsBefore(beforeDate: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.purgeSourceRouteStatsBefore(beforeDate);
  }

  async getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]> {
    const storage = await this.getStorage();
    return storage.getAllSourceRouteStatBuckets();
  }

  async getSharedCache(key: string): Promise<SharedCacheRecord | null> {
    const storage = await this.getStorage();
    return storage.getSharedCache(key);
  }

  async acquireSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    const storage = await this.getStorage();
    return storage.acquireSharedCacheLease(key, token, now, leaseUntil);
  }

  async setSharedCache(
    key: string,
    token: string,
    value: string,
    freshUntil: number,
    staleUntil: number,
    now: number,
  ): Promise<boolean> {
    const storage = await this.getStorage();
    return storage.setSharedCache(
      key,
      token,
      value,
      freshUntil,
      staleUntil,
      now,
    );
  }

  async releaseSharedCacheLease(key: string, token: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.releaseSharedCacheLease(key, token);
  }

  async renewSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    const storage = await this.getStorage();
    return storage.renewSharedCacheLease(key, token, now, leaseUntil);
  }

  async pruneSharedCache(now: number, limit: number): Promise<void> {
    const storage = await this.getStorage();
    await storage.pruneSharedCache(now, limit);
  }

  async getSharedResourceStore() {
    return (await this.getStorage()).resources;
  }
}

export const db = new DbManager();
