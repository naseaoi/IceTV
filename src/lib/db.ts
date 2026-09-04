import 'server-only';

import { AdminConfig } from '@/types/admin';

import { getStorageType } from './storage-type';
import {
  Favorite,
  IStorage,
  MetadataRecordPage,
  PlaybackRangeWatchTotal,
  PlaybackSession,
  PlaybackSessionQuery,
  PlaybackStatsTopItem,
  PlaybackTimeRange,
  PlaybackWatchTotals,
  PlayRecord,
  PlayRecordPage,
  SkipConfig,
  SourceRouteStatInput,
  SourceRouteStatsBucket,
  SourceRouteStatsItem,
  StorageImportData,
  UserMessageState,
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

  /** 按原始 key 写入播放记录（用于数据导入等场景） */
  async setPlayRecordByKey(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setPlayRecord(userName, key, record);
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
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    const storage = await this.getStorage();
    await storage.setFavorite(userName, key, favorite);
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
  ) {
    const storage = await this.getStorage();
    return storage.getFavoritePage(userName, limit, cursorTime, cursorKey);
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

  /** 按原始 key 写入收藏（用于数据导入等场景） */
  async setFavoriteByKey(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    const storage = await this.getStorage();
    await storage.setFavorite(userName, key, favorite);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string,
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.registerUser(userName, password);
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

  async deleteUser(userName: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteUser(userName);
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

  async getAllUsers(): Promise<string[]> {
    const storage = await this.getStorage();
    return storage.getAllUsers();
  }

  async getAllUsersWithPasswords(): Promise<{ [username: string]: string }> {
    const storage = await this.getStorage();
    return storage.getAllUsersWithPasswords();
  }

  async recordUserActivity(userName: string, activeAt: number): Promise<void> {
    const storage = await this.getStorage();
    await storage.recordUserLogin(userName, activeAt);
  }

  async getUserLastActive(userName: string): Promise<number | null> {
    const storage = await this.getStorage();
    return storage.getUserLastLogin(userName);
  }

  async getAllUserLastActive(): Promise<Record<string, number>> {
    const storage = await this.getStorage();
    return storage.getAllUserLastLogins();
  }

  async reserveInviteCodeUse(
    code: string,
    maxUses: number,
    seedCount = 0,
  ): Promise<boolean> {
    const storage = await this.getStorage();
    return storage.reserveInviteCodeUse(code, maxUses, seedCount);
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

  async getPlaybackRangeWatchTotals(
    userName: string,
    ranges: PlaybackTimeRange[],
  ): Promise<PlaybackRangeWatchTotal[]> {
    const storage = await this.getStorage();
    return storage.getPlaybackRangeWatchTotals(userName, ranges);
  }

  async getPlaybackTopItems(
    userName: string,
    limit?: number,
    since?: number,
  ): Promise<PlaybackStatsTopItem[]> {
    const storage = await this.getStorage();
    return storage.getPlaybackTopItems(userName, limit, since);
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

  async getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]> {
    const storage = await this.getStorage();
    return storage.getAllSourceRouteStatBuckets();
  }

  async clearAllData(): Promise<void> {
    const storage = await this.getStorage();
    await storage.clearAllData();
  }

  async replaceAllData(data: StorageImportData): Promise<void> {
    const storage = await this.getStorage();
    await storage.replaceAllData(data);
  }
}

export const db = new DbManager();
