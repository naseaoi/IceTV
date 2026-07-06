import 'server-only';

import { AdminConfig } from '@/types/admin';

import { getStorageType } from './storage-type';
import {
  Favorite,
  IStorage,
  PlaybackRangeWatchTotal,
  PlaybackSession,
  PlaybackSessionQuery,
  PlaybackStatsTopItem,
  PlaybackTimeRange,
  PlaybackWatchTotals,
  PlayRecord,
  SkipConfig,
  SourceRouteStatInput,
  SourceRouteStatsItem,
  StorageImportData,
} from './types';

async function createStorage(): Promise<IStorage> {
  const storageType = getStorageType();

  if (storageType === 'mysql') {
    const { MySqlStorage } = await import('./mysql.db.js');
    return new MySqlStorage();
  }

  const { LocalSqliteStorage } = await import('./sqlite.db.js');
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
