import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

import { AdminConfig } from '@/features/admin/types/api';

import { hashPassword, verifyPassword } from './password';
import {
  Favorite,
  IStorage,
  PlayRecord,
  SkipConfig,
  StorageImportData,
} from './types';

const SEARCH_HISTORY_LIMIT = 20;

function parseBusyTimeoutMs(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: string }).code;
  return code === 'SQLITE_BUSY' || /database is locked/i.test(error.message);
}

function runWithBusyRetry<T>(label: string, task: () => T): T {
  const maxRetries = parseBusyTimeoutMs(process.env.SQLITE_INIT_RETRY_COUNT, 8);
  const retryDelayMs = parseBusyTimeoutMs(
    process.env.SQLITE_INIT_RETRY_DELAY_MS,
    250,
  );

  for (let attempt = 0; ; attempt += 1) {
    try {
      return task();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= maxRetries) {
        throw error;
      }

      console.warn(
        `${label} 遇到数据库忙锁，正在重试（${attempt + 1}/${maxRetries}）...`,
      );
      sleepSync(retryDelayMs * (attempt + 1));
    }
  }
}

type LocalDbSchema = {
  users: Record<string, string>;
  playRecords: Record<string, Record<string, PlayRecord>>;
  favorites: Record<string, Record<string, Favorite>>;
  searchHistory: Record<string, string[]>;
  skipConfigs: Record<string, Record<string, SkipConfig>>;
  adminConfig: AdminConfig | null;
};

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

function parseJsonValue<T>(raw: string | null | undefined): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class LocalSqliteStorage implements IStorage {
  private readonly dbPath: string;
  private readonly legacyJsonPaths: string[];
  private readonly db: Database.Database;

  // 预编译的 Prepared Statements
  private readonly stmts: {
    // play_records
    getPlayRecord: Database.Statement;
    setPlayRecord: Database.Statement;
    getAllPlayRecords: Database.Statement;
    deletePlayRecord: Database.Statement;
    // favorites
    getFavorite: Database.Statement;
    setFavorite: Database.Statement;
    getAllFavorites: Database.Statement;
    deleteFavorite: Database.Statement;
    // users
    registerUser: Database.Statement;
    getPassword: Database.Statement;
    updatePassword: Database.Statement;
    checkUserExist: Database.Statement;
    deleteUserRow: Database.Statement;
    getAllUsers: Database.Statement;
    // search_history
    getSearchHistory: Database.Statement;
    deleteSearchHistoryAll: Database.Statement;
    deleteSearchHistoryOne: Database.Statement;
    deleteSearchHistoryKeyword: Database.Statement;
    updateSearchHistoryIndex: Database.Statement;
    insertSearchHistory: Database.Statement;
    deleteSearchHistoryOverflow: Database.Statement;
    // skip_configs
    getSkipConfig: Database.Statement;
    setSkipConfig: Database.Statement;
    deleteSkipConfig: Database.Statement;
    getAllSkipConfigs: Database.Statement;
    // admin_config
    getAdminConfig: Database.Statement;
    setAdminConfig: Database.Statement;
    // delete by username (for deleteUser transaction)
    deletePlayRecordsByUser: Database.Statement;
    deleteFavoritesByUser: Database.Statement;
    deleteSearchHistoryByUser: Database.Statement;
    deleteSkipConfigsByUser: Database.Statement;
  };

  constructor(dbPath?: string) {
    const defaultSqlitePath = process.env.DOCKER_ENV
      ? '/data/icetv-data.sqlite'
      : path.resolve(process.cwd(), 'data', 'icetv-data.sqlite');
    const defaultJsonPath = process.env.DOCKER_ENV
      ? '/data/icetv-data.json'
      : path.resolve(process.cwd(), 'data', 'icetv-data.json');
    const legacyJsonPath = process.env.DOCKER_ENV
      ? '/data/moontv-data.json'
      : path.resolve(process.cwd(), 'data', 'moontv-data.json');

    const configuredPath =
      dbPath ||
      process.env.LOCAL_SQLITE_PATH ||
      process.env.LOCAL_DB_PATH ||
      defaultSqlitePath;

    const isLegacyJsonPath = configuredPath.toLowerCase().endsWith('.json');
    this.dbPath = isLegacyJsonPath
      ? configuredPath.replace(/\.json$/i, '.sqlite')
      : configuredPath;

    const candidates = [defaultJsonPath, legacyJsonPath];
    if (isLegacyJsonPath) {
      candidates.unshift(configuredPath);
    }
    this.legacyJsonPaths = Array.from(new Set(candidates));

    mkdirSync(path.dirname(this.dbPath), { recursive: true });

    const busyTimeoutMs = parseBusyTimeoutMs(
      process.env.SQLITE_BUSY_TIMEOUT_MS,
      5000,
    );
    this.db = runWithBusyRetry('打开 SQLite 数据库', () => {
      return new Database(this.dbPath, { timeout: busyTimeoutMs });
    });
    runWithBusyRetry('初始化 SQLite 数据库', () => {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
      this.initializeSchema();
    });
    this.stmts = this.prepareStatements();
    runWithBusyRetry('迁移 SQLite 历史数据', () => {
      this.migrateFromLegacyJsonIfNeeded();
    });
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS play_records (
        username TEXT NOT NULL,
        record_key TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (username, record_key)
      );

      CREATE TABLE IF NOT EXISTS favorites (
        username TEXT NOT NULL,
        favorite_key TEXT NOT NULL,
        favorite_json TEXT NOT NULL,
        PRIMARY KEY (username, favorite_key)
      );

      CREATE TABLE IF NOT EXISTS search_history (
        username TEXT NOT NULL,
        keyword TEXT NOT NULL,
        sort_index INTEGER NOT NULL,
        PRIMARY KEY (username, keyword)
      );

      CREATE TABLE IF NOT EXISTS skip_configs (
        username TEXT NOT NULL,
        config_key TEXT NOT NULL,
        config_json TEXT NOT NULL,
        PRIMARY KEY (username, config_key)
      );

      CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        config_json TEXT NOT NULL
      );
    `);
  }

  private prepareStatements(): typeof this.stmts {
    return {
      // play_records
      getPlayRecord: this.db.prepare(
        'SELECT record_json FROM play_records WHERE username = ? AND record_key = ?',
      ),
      setPlayRecord: this.db.prepare(
        'INSERT OR REPLACE INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
      ),
      getAllPlayRecords: this.db.prepare(
        'SELECT record_key, record_json FROM play_records WHERE username = ?',
      ),
      deletePlayRecord: this.db.prepare(
        'DELETE FROM play_records WHERE username = ? AND record_key = ?',
      ),
      // favorites
      getFavorite: this.db.prepare(
        'SELECT favorite_json FROM favorites WHERE username = ? AND favorite_key = ?',
      ),
      setFavorite: this.db.prepare(
        'INSERT OR REPLACE INTO favorites (username, favorite_key, favorite_json) VALUES (?, ?, ?)',
      ),
      getAllFavorites: this.db.prepare(
        'SELECT favorite_key, favorite_json FROM favorites WHERE username = ?',
      ),
      deleteFavorite: this.db.prepare(
        'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
      ),
      // users
      registerUser: this.db.prepare(
        'INSERT OR REPLACE INTO users (username, password) VALUES (?, ?)',
      ),
      getPassword: this.db.prepare(
        'SELECT password FROM users WHERE username = ?',
      ),
      updatePassword: this.db.prepare(
        'UPDATE users SET password = ? WHERE username = ?',
      ),
      checkUserExist: this.db.prepare(
        'SELECT 1 AS v FROM users WHERE username = ? LIMIT 1',
      ),
      deleteUserRow: this.db.prepare('DELETE FROM users WHERE username = ?'),
      getAllUsers: this.db.prepare(
        'SELECT username FROM users ORDER BY username ASC',
      ),
      // search_history
      getSearchHistory: this.db.prepare(
        'SELECT keyword FROM search_history WHERE username = ? ORDER BY sort_index ASC',
      ),
      deleteSearchHistoryAll: this.db.prepare(
        'DELETE FROM search_history WHERE username = ?',
      ),
      deleteSearchHistoryOne: this.db.prepare(
        'DELETE FROM search_history WHERE username = ? AND keyword = ?',
      ),
      deleteSearchHistoryKeyword: this.db.prepare(
        'DELETE FROM search_history WHERE username = ? AND keyword = ?',
      ),
      updateSearchHistoryIndex: this.db.prepare(
        'UPDATE search_history SET sort_index = sort_index + 1 WHERE username = ?',
      ),
      insertSearchHistory: this.db.prepare(
        'INSERT OR REPLACE INTO search_history (username, keyword, sort_index) VALUES (?, ?, ?)',
      ),
      deleteSearchHistoryOverflow: this.db.prepare(
        'DELETE FROM search_history WHERE username = ? AND sort_index >= ?',
      ),
      // skip_configs
      getSkipConfig: this.db.prepare(
        'SELECT config_json FROM skip_configs WHERE username = ? AND config_key = ?',
      ),
      setSkipConfig: this.db.prepare(
        'INSERT OR REPLACE INTO skip_configs (username, config_key, config_json) VALUES (?, ?, ?)',
      ),
      deleteSkipConfig: this.db.prepare(
        'DELETE FROM skip_configs WHERE username = ? AND config_key = ?',
      ),
      getAllSkipConfigs: this.db.prepare(
        'SELECT config_key, config_json FROM skip_configs WHERE username = ?',
      ),
      // admin_config
      getAdminConfig: this.db.prepare(
        'SELECT config_json FROM admin_config WHERE id = 1',
      ),
      setAdminConfig: this.db.prepare(
        'INSERT OR REPLACE INTO admin_config (id, config_json) VALUES (1, ?)',
      ),
      // delete by username
      deletePlayRecordsByUser: this.db.prepare(
        'DELETE FROM play_records WHERE username = ?',
      ),
      deleteFavoritesByUser: this.db.prepare(
        'DELETE FROM favorites WHERE username = ?',
      ),
      deleteSearchHistoryByUser: this.db.prepare(
        'DELETE FROM search_history WHERE username = ?',
      ),
      deleteSkipConfigsByUser: this.db.prepare(
        'DELETE FROM skip_configs WHERE username = ?',
      ),
    };
  }

  private hasAnyData(): boolean {
    const checks = [
      'SELECT 1 AS v FROM users LIMIT 1',
      'SELECT 1 AS v FROM play_records LIMIT 1',
      'SELECT 1 AS v FROM favorites LIMIT 1',
      'SELECT 1 AS v FROM search_history LIMIT 1',
      'SELECT 1 AS v FROM skip_configs LIMIT 1',
      'SELECT 1 AS v FROM admin_config LIMIT 1',
    ];
    return checks.some((sql) => Boolean(this.db.prepare(sql).get()));
  }

  private readLegacyJsonData(): LocalDbSchema | null {
    for (const legacyPath of this.legacyJsonPaths) {
      if (!existsSync(legacyPath)) {
        continue;
      }
      try {
        const content = readFileSync(legacyPath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        return normalizeDbData(parsed);
      } catch (error) {
        console.error(`读取旧 JSON 数据失败: ${legacyPath}`, error);
      }
    }
    return null;
  }

  private migrateFromLegacyJsonIfNeeded(): void {
    if (this.hasAnyData()) {
      return;
    }

    const legacyData = this.readLegacyJsonData();
    if (!legacyData) {
      return;
    }

    const migrate = this.db.transaction(() => {
      const insertUser = this.db.prepare(
        'INSERT OR REPLACE INTO users (username, password) VALUES (?, ?)',
      );
      const insertPlayRecord = this.db.prepare(
        'INSERT OR REPLACE INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
      );
      const insertFavorite = this.db.prepare(
        'INSERT OR REPLACE INTO favorites (username, favorite_key, favorite_json) VALUES (?, ?, ?)',
      );
      const insertHistory = this.db.prepare(
        'INSERT OR REPLACE INTO search_history (username, keyword, sort_index) VALUES (?, ?, ?)',
      );
      const insertSkipConfig = this.db.prepare(
        'INSERT OR REPLACE INTO skip_configs (username, config_key, config_json) VALUES (?, ?, ?)',
      );
      const insertAdminConfig = this.db.prepare(
        'INSERT OR REPLACE INTO admin_config (id, config_json) VALUES (1, ?)',
      );

      for (const [userName, password] of Object.entries(legacyData.users)) {
        insertUser.run(userName, password);
      }

      for (const [userName, records] of Object.entries(
        legacyData.playRecords,
      )) {
        for (const [key, record] of Object.entries(records)) {
          insertPlayRecord.run(userName, key, JSON.stringify(record));
        }
      }

      for (const [userName, favorites] of Object.entries(
        legacyData.favorites,
      )) {
        for (const [key, favorite] of Object.entries(favorites)) {
          insertFavorite.run(userName, key, JSON.stringify(favorite));
        }
      }

      for (const [userName, keywords] of Object.entries(
        legacyData.searchHistory,
      )) {
        if (!Array.isArray(keywords)) {
          continue;
        }
        keywords.slice(0, SEARCH_HISTORY_LIMIT).forEach((keyword, index) => {
          insertHistory.run(userName, keyword, index);
        });
      }

      for (const [userName, configs] of Object.entries(
        legacyData.skipConfigs,
      )) {
        for (const [key, config] of Object.entries(configs)) {
          insertSkipConfig.run(userName, key, JSON.stringify(config));
        }
      }

      if (legacyData.adminConfig) {
        insertAdminConfig.run(JSON.stringify(legacyData.adminConfig));
      }
    });

    migrate();
    console.log(`检测到旧 JSON 数据，已迁移到 SQLite: ${this.dbPath}`);
  }

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    const row = this.stmts.getPlayRecord.get(userName, key) as
      | { record_json: string }
      | undefined;
    return parseJsonValue<PlayRecord>(row?.record_json);
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    this.stmts.setPlayRecord.run(userName, key, JSON.stringify(record));
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    const rows = this.stmts.getAllPlayRecords.all(userName) as {
      record_key: string;
      record_json: string;
    }[];

    const result: Record<string, PlayRecord> = {};
    for (const row of rows) {
      const parsed = parseJsonValue<PlayRecord>(row.record_json);
      if (parsed) {
        result[row.record_key] = parsed;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    this.stmts.deletePlayRecord.run(userName, key);
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    this.stmts.deletePlayRecordsByUser.run(userName);
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const row = this.stmts.getFavorite.get(userName, key) as
      | { favorite_json: string }
      | undefined;
    return parseJsonValue<Favorite>(row?.favorite_json);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    this.stmts.setFavorite.run(userName, key, JSON.stringify(favorite));
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    const rows = this.stmts.getAllFavorites.all(userName) as {
      favorite_key: string;
      favorite_json: string;
    }[];

    const result: Record<string, Favorite> = {};
    for (const row of rows) {
      const parsed = parseJsonValue<Favorite>(row.favorite_json);
      if (parsed) {
        result[row.favorite_key] = parsed;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    this.stmts.deleteFavorite.run(userName, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    this.stmts.deleteFavoritesByUser.run(userName);
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashed = await hashPassword(password);
    this.stmts.registerUser.run(userName, hashed);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const row = this.stmts.getPassword.get(userName) as
      | { password: string }
      | undefined;
    if (!row) return false;

    const { match, needsRehash } = await verifyPassword(password, row.password);
    if (match && needsRehash) {
      const hashed = await hashPassword(password);
      this.stmts.updatePassword.run(hashed, userName);
    }
    return match;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return Boolean(this.stmts.checkUserExist.get(userName));
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashed = await hashPassword(newPassword);
    this.stmts.updatePassword.run(hashed, userName);
  }

  async deleteUser(userName: string): Promise<void> {
    const remove = this.db.transaction((targetUser: string) => {
      this.stmts.deleteUserRow.run(targetUser);
      this.stmts.deletePlayRecordsByUser.run(targetUser);
      this.stmts.deleteFavoritesByUser.run(targetUser);
      this.stmts.deleteSearchHistoryByUser.run(targetUser);
      this.stmts.deleteSkipConfigsByUser.run(targetUser);
    });
    remove(userName);
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const rows = this.stmts.getSearchHistory.all(userName) as {
      keyword: string;
    }[];
    return rows.map((row) => row.keyword);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    // 纯 SQL 优化：避免先 SELECT 全部再 JS 处理再 DELETE+INSERT 的 N+1 模式
    const save = this.db.transaction((targetUser: string, kw: string) => {
      // 1. 删除该关键词（如果已存在）
      this.stmts.deleteSearchHistoryKeyword.run(targetUser, kw);
      // 2. 所有现有记录 sort_index + 1
      this.stmts.updateSearchHistoryIndex.run(targetUser);
      // 3. 插入新关键词到 sort_index = 0
      this.stmts.insertSearchHistory.run(targetUser, kw, 0);
      // 4. 删除超出限制的记录
      this.stmts.deleteSearchHistoryOverflow.run(
        targetUser,
        SEARCH_HISTORY_LIMIT,
      );
    });
    save(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    if (!keyword) {
      this.stmts.deleteSearchHistoryAll.run(userName);
      return;
    }
    this.stmts.deleteSearchHistoryOne.run(userName, keyword);
  }

  async getAllUsers(): Promise<string[]> {
    const rows = this.stmts.getAllUsers.all() as { username: string }[];
    return rows.map((row) => row.username);
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const row = this.stmts.getAdminConfig.get() as
      | { config_json: string }
      | undefined;
    return parseJsonValue<AdminConfig>(row?.config_json);
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    this.stmts.setAdminConfig.run(JSON.stringify(config));
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const key = `${source}+${id}`;
    const row = this.stmts.getSkipConfig.get(userName, key) as
      | { config_json: string }
      | undefined;
    return parseJsonValue<SkipConfig>(row?.config_json);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    const key = `${source}+${id}`;
    this.stmts.setSkipConfig.run(userName, key, JSON.stringify(config));
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = `${source}+${id}`;
    this.stmts.deleteSkipConfig.run(userName, key);
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    const rows = this.stmts.getAllSkipConfigs.all(userName) as {
      config_key: string;
      config_json: string;
    }[];

    const result: Record<string, SkipConfig> = {};
    for (const row of rows) {
      const parsed = parseJsonValue<SkipConfig>(row.config_json);
      if (parsed) {
        result[row.config_key] = parsed;
      }
    }
    return result;
  }

  async clearAllData(): Promise<void> {
    const clear = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM users;
        DELETE FROM play_records;
        DELETE FROM favorites;
        DELETE FROM search_history;
        DELETE FROM skip_configs;
        DELETE FROM admin_config;
      `);
    });

    clear();
    console.log(`SQLite 数据库已清空: ${this.dbPath}`);
  }

  async replaceAllData(data: StorageImportData): Promise<void> {
    const replace = this.db.transaction((snapshot: StorageImportData) => {
      this.db.exec(`
        DELETE FROM users;
        DELETE FROM play_records;
        DELETE FROM favorites;
        DELETE FROM search_history;
        DELETE FROM skip_configs;
        DELETE FROM admin_config;
      `);

      this.stmts.setAdminConfig.run(JSON.stringify(snapshot.adminConfig));

      for (const [userName, passwordHash] of Object.entries(snapshot.users)) {
        this.stmts.registerUser.run(userName, passwordHash);
      }

      for (const [userName, userData] of Object.entries(snapshot.userData)) {
        for (const [key, record] of Object.entries(userData.playRecords)) {
          this.stmts.setPlayRecord.run(userName, key, JSON.stringify(record));
        }

        for (const [key, favorite] of Object.entries(userData.favorites)) {
          this.stmts.setFavorite.run(userName, key, JSON.stringify(favorite));
        }

        userData.searchHistory
          .slice(0, SEARCH_HISTORY_LIMIT)
          .forEach((keyword, index) => {
            this.stmts.insertSearchHistory.run(userName, keyword, index);
          });

        for (const [key, config] of Object.entries(userData.skipConfigs)) {
          this.stmts.setSkipConfig.run(userName, key, JSON.stringify(config));
        }
      }
    });

    replace(data);
  }
}
