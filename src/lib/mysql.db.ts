import 'server-only';

import mysql from 'mysql2/promise';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { AdminConfig } from '@/types/admin';

import { hashPassword, verifyPassword } from './password';
import { getMySqlConnectionUrl } from './storage-type';
import {
  Favorite,
  IStorage,
  PlayRecord,
  SkipConfig,
  StorageImportData,
} from './types';

const SEARCH_HISTORY_LIMIT = 20;

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function buildSslOptions() {
  if (!process.env.MYSQL_SSL_CA) {
    return undefined;
  }

  return {
    ca: process.env.MYSQL_SSL_CA,
    rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

function createPoolOptions(databaseUrl: string): mysql.PoolOptions {
  const parsedUrl = new URL(databaseUrl);

  if (parsedUrl.protocol !== 'mysql:') {
    throw new Error('MySQL 连接串必须以 mysql:// 开头');
  }

  const databaseName = parsedUrl.pathname.replace(/^\//, '');
  if (!databaseName) {
    throw new Error('MySQL 连接串缺少数据库名');
  }

  return {
    host: parsedUrl.hostname,
    port: parseInteger(parsedUrl.port, 3306),
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: decodeURIComponent(databaseName),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: parseInteger(process.env.MYSQL_CONNECTION_LIMIT, 5),
    maxIdle: parseInteger(process.env.MYSQL_MAX_IDLE, 5),
    idleTimeout: parseInteger(process.env.MYSQL_IDLE_TIMEOUT_MS, 60000),
    queueLimit: 0,
    ssl: buildSslOptions(),
  };
}

type JsonRow = RowDataPacket & {
  record_json?: string;
  favorite_json?: string;
  config_json?: string;
  password?: string;
  username?: string;
  keyword?: string;
  record_key?: string;
  favorite_key?: string;
  config_key?: string;
};

export class MySqlStorage implements IStorage {
  private readonly pool: ReturnType<typeof mysql.createPool>;
  private initPromise: Promise<void> | null = null;

  constructor(databaseUrl?: string) {
    const resolvedUrl = databaseUrl || getMySqlConnectionUrl();

    if (!resolvedUrl) {
      throw new Error('MySQL 存储模式缺少连接串，请配置 DATABASE_URL');
    }

    this.pool = mysql.createPool(createPoolOptions(resolvedUrl));
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }

    return this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(191) NOT NULL PRIMARY KEY,
        password TEXT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS play_records (
        username VARCHAR(191) NOT NULL,
        record_key VARCHAR(255) NOT NULL,
        record_json LONGTEXT NOT NULL,
        PRIMARY KEY (username, record_key)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS favorites (
        username VARCHAR(191) NOT NULL,
        favorite_key VARCHAR(255) NOT NULL,
        favorite_json LONGTEXT NOT NULL,
        PRIMARY KEY (username, favorite_key)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS search_history (
        username VARCHAR(191) NOT NULL,
        keyword VARCHAR(191) NOT NULL,
        sort_index INT NOT NULL,
        PRIMARY KEY (username, keyword),
        KEY idx_search_history_order (username, sort_index)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS skip_configs (
        username VARCHAR(191) NOT NULL,
        config_key VARCHAR(255) NOT NULL,
        config_json LONGTEXT NOT NULL,
        PRIMARY KEY (username, config_key)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS admin_config (
        id TINYINT NOT NULL PRIMARY KEY,
        config_json LONGTEXT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    ];

    for (const statement of statements) {
      await this.pool.execute(statement);
    }
  }

  private async withTransaction<T>(
    task: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await task(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT record_json FROM play_records WHERE username = ? AND record_key = ? LIMIT 1',
      [userName, key],
    );
    return parseJsonValue<PlayRecord>(rows[0]?.record_json);
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      `INSERT INTO play_records (username, record_key, record_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json)`,
      [userName, key, JSON.stringify(record)],
    );
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT record_key, record_json FROM play_records WHERE username = ?',
      [userName],
    );

    const result: Record<string, PlayRecord> = {};
    for (const row of rows) {
      const parsed = parseJsonValue<PlayRecord>(row.record_json);
      if (parsed && row.record_key) {
        result[row.record_key] = parsed;
      }
    }

    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      'DELETE FROM play_records WHERE username = ? AND record_key = ?',
      [userName, key],
    );
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute('DELETE FROM play_records WHERE username = ?', [
      userName,
    ]);
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT favorite_json FROM favorites WHERE username = ? AND favorite_key = ? LIMIT 1',
      [userName, key],
    );
    return parseJsonValue<Favorite>(rows[0]?.favorite_json);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      `INSERT INTO favorites (username, favorite_key, favorite_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE favorite_json = VALUES(favorite_json)`,
      [userName, key, JSON.stringify(favorite)],
    );
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT favorite_key, favorite_json FROM favorites WHERE username = ?',
      [userName],
    );

    const result: Record<string, Favorite> = {};
    for (const row of rows) {
      const parsed = parseJsonValue<Favorite>(row.favorite_json);
      if (parsed && row.favorite_key) {
        result[row.favorite_key] = parsed;
      }
    }

    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
      [userName, key],
    );
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute('DELETE FROM favorites WHERE username = ?', [
      userName,
    ]);
  }

  async registerUser(userName: string, password: string): Promise<void> {
    await this.ensureInitialized();
    const hashed = await hashPassword(password);
    await this.pool.execute(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [userName, hashed],
    );
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT password FROM users WHERE username = ? LIMIT 1',
      [userName],
    );
    const stored = rows[0]?.password;

    if (!stored) {
      return false;
    }

    const { match, needsRehash } = await verifyPassword(password, stored);

    if (match && needsRehash) {
      const hashed = await hashPassword(password);
      await this.pool.execute(
        'UPDATE users SET password = ? WHERE username = ?',
        [hashed, userName],
      );
    }

    return match;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT 1 AS v FROM users WHERE username = ? LIMIT 1',
      [userName],
    );
    return rows.length > 0;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.ensureInitialized();
    const hashed = await hashPassword(newPassword);
    await this.pool.execute(
      'UPDATE users SET password = ? WHERE username = ?',
      [hashed, userName],
    );
  }

  async deleteUser(userName: string): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM users WHERE username = ?', [
        userName,
      ]);
      await connection.execute('DELETE FROM play_records WHERE username = ?', [
        userName,
      ]);
      await connection.execute('DELETE FROM favorites WHERE username = ?', [
        userName,
      ]);
      await connection.execute(
        'DELETE FROM search_history WHERE username = ?',
        [userName],
      );
      await connection.execute('DELETE FROM skip_configs WHERE username = ?', [
        userName,
      ]);
    });
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT keyword FROM search_history WHERE username = ? ORDER BY sort_index ASC',
      [userName],
    );
    return rows.map((row) => row.keyword).filter(Boolean) as string[];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute(
        'DELETE FROM search_history WHERE username = ? AND keyword = ?',
        [userName, keyword],
      );
      await connection.execute(
        'UPDATE search_history SET sort_index = sort_index + 1 WHERE username = ?',
        [userName],
      );
      await connection.execute(
        'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, 0)',
        [userName, keyword],
      );
      await connection.execute(
        'DELETE FROM search_history WHERE username = ? AND sort_index >= ?',
        [userName, SEARCH_HISTORY_LIMIT],
      );
    });
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.ensureInitialized();

    if (!keyword) {
      await this.pool.execute('DELETE FROM search_history WHERE username = ?', [
        userName,
      ]);
      return;
    }

    await this.pool.execute(
      'DELETE FROM search_history WHERE username = ? AND keyword = ?',
      [userName, keyword],
    );
  }

  async getAllUsers(): Promise<string[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT username FROM users ORDER BY username ASC',
    );
    return rows.map((row) => row.username).filter(Boolean) as string[];
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT config_json FROM admin_config WHERE id = 1 LIMIT 1',
    );
    return parseJsonValue<AdminConfig>(rows[0]?.config_json);
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      `INSERT INTO admin_config (id, config_json)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)`,
      [JSON.stringify(config)],
    );
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    await this.ensureInitialized();
    const key = `${source}+${id}`;
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT config_json FROM skip_configs WHERE username = ? AND config_key = ? LIMIT 1',
      [userName, key],
    );
    return parseJsonValue<SkipConfig>(rows[0]?.config_json);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    await this.ensureInitialized();
    const key = `${source}+${id}`;
    await this.pool.execute(
      `INSERT INTO skip_configs (username, config_key, config_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)`,
      [userName, key, JSON.stringify(config)],
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const key = `${source}+${id}`;
    await this.pool.execute(
      'DELETE FROM skip_configs WHERE username = ? AND config_key = ?',
      [userName, key],
    );
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT config_key, config_json FROM skip_configs WHERE username = ?',
      [userName],
    );

    const result: Record<string, SkipConfig> = {};
    for (const row of rows) {
      const parsed = parseJsonValue<SkipConfig>(row.config_json);
      if (parsed && row.config_key) {
        result[row.config_key] = parsed;
      }
    }

    return result;
  }

  async clearAllData(): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM users');
      await connection.execute('DELETE FROM play_records');
      await connection.execute('DELETE FROM favorites');
      await connection.execute('DELETE FROM search_history');
      await connection.execute('DELETE FROM skip_configs');
      await connection.execute('DELETE FROM admin_config');
    });
  }

  async replaceAllData(data: StorageImportData): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM users');
      await connection.execute('DELETE FROM play_records');
      await connection.execute('DELETE FROM favorites');
      await connection.execute('DELETE FROM search_history');
      await connection.execute('DELETE FROM skip_configs');
      await connection.execute('DELETE FROM admin_config');

      await connection.execute(
        'INSERT INTO admin_config (id, config_json) VALUES (1, ?)',
        [JSON.stringify(data.adminConfig)],
      );

      for (const [userName, passwordHash] of Object.entries(data.users)) {
        await connection.execute(
          'INSERT INTO users (username, password) VALUES (?, ?)',
          [userName, passwordHash],
        );
      }

      for (const [userName, userData] of Object.entries(data.userData)) {
        for (const [key, record] of Object.entries(userData.playRecords)) {
          await connection.execute(
            'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
            [userName, key, JSON.stringify(record)],
          );
        }

        for (const [key, favorite] of Object.entries(userData.favorites)) {
          await connection.execute(
            'INSERT INTO favorites (username, favorite_key, favorite_json) VALUES (?, ?, ?)',
            [userName, key, JSON.stringify(favorite)],
          );
        }

        const searchHistory = userData.searchHistory.slice(
          0,
          SEARCH_HISTORY_LIMIT,
        );
        for (let index = 0; index < searchHistory.length; index++) {
          const keyword = searchHistory[index];
          await connection.execute(
            'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, ?)',
            [userName, keyword, index],
          );
        }

        for (const [key, config] of Object.entries(userData.skipConfigs)) {
          await connection.execute(
            'INSERT INTO skip_configs (username, config_key, config_json) VALUES (?, ?, ?)',
            [userName, key, JSON.stringify(config)],
          );
        }
      }
    });
  }
}
