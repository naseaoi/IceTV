/* eslint-disable no-console */

import { existsSync, promises as fs } from 'fs';
import path from 'path';

import { AdminConfig } from './admin.types';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

const SEARCH_HISTORY_LIMIT = 20;

type LocalDbSchema = {
  users: Record<string, string>;
  playRecords: Record<string, Record<string, PlayRecord>>;
  favorites: Record<string, Record<string, Favorite>>;
  searchHistory: Record<string, string[]>;
  skipConfigs: Record<string, Record<string, SkipConfig>>;
  adminConfig: AdminConfig | null;
};

const EMPTY_DB: LocalDbSchema = {
  users: {},
  playRecords: {},
  favorites: {},
  searchHistory: {},
  skipConfigs: {},
  adminConfig: null,
};

function cloneEmptyDb(): LocalDbSchema {
  return {
    users: {},
    playRecords: {},
    favorites: {},
    searchHistory: {},
    skipConfigs: {},
    adminConfig: null,
  };
}

function ensureObject<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function normalizeDbData(raw: unknown): LocalDbSchema {
  const db = ensureObject<Partial<LocalDbSchema>>(raw, {});
  return {
    users: ensureObject<Record<string, string>>(db.users, {}),
    playRecords: ensureObject<Record<string, Record<string, PlayRecord>>>(
      db.playRecords,
      {},
    ),
    favorites: ensureObject<Record<string, Record<string, Favorite>>>(
      db.favorites,
      {},
    ),
    searchHistory: ensureObject<Record<string, string[]>>(db.searchHistory, {}),
    skipConfigs: ensureObject<Record<string, Record<string, SkipConfig>>>(
      db.skipConfigs,
      {},
    ),
    adminConfig: db.adminConfig || null,
  };
}

export class LocalFileStorage implements IStorage {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    const defaultPath = process.env.DOCKER_ENV
      ? '/data/icetv-data.json'
      : path.resolve(process.cwd(), 'data', 'icetv-data.json');
    const legacyDefaultPath = process.env.DOCKER_ENV
      ? '/data/moontv-data.json'
      : path.resolve(process.cwd(), 'data', 'moontv-data.json');
    const resolvedDefaultPath =
      existsSync(defaultPath) || !existsSync(legacyDefaultPath)
        ? defaultPath
        : legacyDefaultPath;

    this.filePath =
      filePath || process.env.LOCAL_DB_PATH || resolvedDefaultPath;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async ensureDbFileExists(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(
        this.filePath,
        JSON.stringify(EMPTY_DB, null, 2),
        'utf-8',
      );
    }
  }

  private async readDb(): Promise<LocalDbSchema> {
    await this.ensureDbFileExists();
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      return normalizeDbData(parsed);
    } catch (error) {
      console.error('读取本地数据库失败，使用空数据回退:', error);
      return cloneEmptyDb();
    }
  }

  private async writeDb(data: LocalDbSchema): Promise<void> {
    await this.ensureDbFileExists();
    const tempPath = `${this.filePath}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, payload, 'utf-8');
    await fs.rename(tempPath, this.filePath);
  }

  private getUserBucket<T>(
    bucket: Record<string, Record<string, T>>,
    user: string,
  ) {
    if (!bucket[user]) {
      bucket[user] = {};
    }
    return bucket[user];
  }

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.playRecords[userName]?.[key] || null;
    });
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      this.getUserBucket(db.playRecords, userName)[key] = record;
      await this.writeDb(db);
    });
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.playRecords[userName] || {};
    });
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      if (db.playRecords[userName]) {
        delete db.playRecords[userName][key];
      }
      await this.writeDb(db);
    });
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.favorites[userName]?.[key] || null;
    });
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      this.getUserBucket(db.favorites, userName)[key] = favorite;
      await this.writeDb(db);
    });
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.favorites[userName] || {};
    });
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      if (db.favorites[userName]) {
        delete db.favorites[userName][key];
      }
      await this.writeDb(db);
    });
  }

  async registerUser(userName: string, password: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      db.users[userName] = password;
      await this.writeDb(db);
    });
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.users[userName] === password;
    });
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return Object.prototype.hasOwnProperty.call(db.users, userName);
    });
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      if (Object.prototype.hasOwnProperty.call(db.users, userName)) {
        db.users[userName] = newPassword;
        await this.writeDb(db);
      }
    });
  }

  async deleteUser(userName: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      delete db.users[userName];
      delete db.playRecords[userName];
      delete db.favorites[userName];
      delete db.searchHistory[userName];
      delete db.skipConfigs[userName];
      await this.writeDb(db);
    });
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return Array.isArray(db.searchHistory[userName])
        ? db.searchHistory[userName]
        : [];
    });
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      const current = Array.isArray(db.searchHistory[userName])
        ? db.searchHistory[userName]
        : [];
      const next = [
        keyword,
        ...current.filter((item) => item !== keyword),
      ].slice(0, SEARCH_HISTORY_LIMIT);
      db.searchHistory[userName] = next;
      await this.writeDb(db);
    });
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      if (!Array.isArray(db.searchHistory[userName])) {
        return;
      }
      if (!keyword) {
        delete db.searchHistory[userName];
      } else {
        db.searchHistory[userName] = db.searchHistory[userName].filter(
          (item) => item !== keyword,
        );
      }
      await this.writeDb(db);
    });
  }

  async getAllUsers(): Promise<string[]> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return Object.keys(db.users);
    });
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.adminConfig;
    });
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    return this.withLock(async () => {
      const db = await this.readDb();
      db.adminConfig = config;
      await this.writeDb(db);
    });
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const key = `${source}+${id}`;
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.skipConfigs[userName]?.[key] || null;
    });
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    const key = `${source}+${id}`;
    return this.withLock(async () => {
      const db = await this.readDb();
      this.getUserBucket(db.skipConfigs, userName)[key] = config;
      await this.writeDb(db);
    });
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = `${source}+${id}`;
    return this.withLock(async () => {
      const db = await this.readDb();
      if (db.skipConfigs[userName]) {
        delete db.skipConfigs[userName][key];
      }
      await this.writeDb(db);
    });
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    return this.withLock(async () => {
      const db = await this.readDb();
      return db.skipConfigs[userName] || {};
    });
  }

  async clearAllData(): Promise<void> {
    return this.withLock(async () => {
      await this.writeDb(cloneEmptyDb());
      console.log(`本地数据库已清空: ${this.filePath}`);
    });
  }
}
