import 'server-only';

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import mysql from 'mysql2/promise';

import { AdminConfig } from '@/types/admin';

import { hashPassword, verifyPassword } from './password';
import {
  buildPlaybackSearchLikePattern,
  normalizePlaybackSearchKeyword,
} from './playback-query';
import { getMySqlConnectionUrl } from './storage-type';
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
  SourceRouteStatsBucket,
  SourceRouteStatsItem,
  StorageImportData,
} from './types';
import { assertValidUsernameFormat, normalizeUsername } from './username';

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
  id?: string;
  source?: string;
  video_id?: string;
  episode_index?: number;
  title?: string;
  source_name?: string;
  cover?: string;
  year?: string;
  started_at?: number;
  ended_at?: number;
  watch_seconds?: number;
  last_position?: number;
  total_time?: number;
  created_at?: number;
  updated_at?: number;
  total_watch_seconds?: number | string;
  period_watch_seconds?: number | string;
  session_count?: number | string;
  last_watched_at?: number | string;
  password?: string;
  username?: string;
  keyword?: string;
  record_key?: string;
  favorite_key?: string;
  config_key?: string;
  route_mode?: string;
  bucket_date?: string;
  success_count?: number | string;
  failure_count?: number | string;
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
      this.initPromise = this.initializeSchema().catch((error) => {
        this.initPromise = null;
        throw error;
      });
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
      `CREATE TABLE IF NOT EXISTS playback_sessions (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        username VARCHAR(191) NOT NULL,
        source VARCHAR(191) NOT NULL,
        video_id VARCHAR(255) NOT NULL,
        episode_index INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        source_name VARCHAR(255) NOT NULL,
        cover TEXT NOT NULL,
        year VARCHAR(32) NOT NULL,
        started_at BIGINT NOT NULL,
        ended_at BIGINT NOT NULL,
        watch_seconds INT NOT NULL,
        last_position INT NOT NULL,
        total_time INT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        KEY idx_playback_sessions_user_started_at (username, started_at),
        KEY idx_playback_sessions_user_video (username, source, video_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS admin_config (
        id TINYINT NOT NULL PRIMARY KEY,
        config_json LONGTEXT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS source_route_stats (
        source VARCHAR(191) NOT NULL,
        route_mode VARCHAR(16) NOT NULL,
        bucket_date CHAR(10) NOT NULL,
        success_count INT NOT NULL DEFAULT 0,
        failure_count INT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (source, route_mode, bucket_date),
        KEY idx_source_route_stats_bucket (bucket_date)
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
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT record_json FROM play_records WHERE username = ? AND record_key = ? LIMIT 1',
      [username, key],
    );
    return parseJsonValue<PlayRecord>(rows[0]?.record_json);
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      `INSERT INTO play_records (username, record_key, record_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json)`,
      [username, key, JSON.stringify(record)],
    );
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT record_key, record_json FROM play_records WHERE username = ?',
      [username],
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
    const username = normalizeUsername(userName);
    await this.pool.execute(
      'DELETE FROM play_records WHERE username = ? AND record_key = ?',
      [username, key],
    );
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute('DELETE FROM play_records WHERE username = ?', [
      username,
    ]);
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT favorite_json FROM favorites WHERE username = ? AND favorite_key = ? LIMIT 1',
      [username, key],
    );
    return parseJsonValue<Favorite>(rows[0]?.favorite_json);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      `INSERT INTO favorites (username, favorite_key, favorite_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE favorite_json = VALUES(favorite_json)`,
      [username, key, JSON.stringify(favorite)],
    );
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT favorite_key, favorite_json FROM favorites WHERE username = ?',
      [username],
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
    const username = normalizeUsername(userName);
    await this.pool.execute(
      'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
      [username, key],
    );
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute('DELETE FROM favorites WHERE username = ?', [
      username,
    ]);
  }

  async registerUser(userName: string, password: string): Promise<void> {
    await this.ensureInitialized();
    const username = assertValidUsernameFormat(userName);
    const hashed = await hashPassword(password);
    await this.pool.execute(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashed],
    );
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT password FROM users WHERE username = ? LIMIT 1',
      [username],
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
        [hashed, username],
      );
    }

    return match;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT 1 AS v FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    return rows.length > 0;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const hashed = await hashPassword(newPassword);
    await this.pool.execute(
      'UPDATE users SET password = ? WHERE username = ?',
      [hashed, username],
    );
  }

  async deleteUser(userName: string): Promise<void> {
    const username = normalizeUsername(userName);
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM users WHERE username = ?', [
        username,
      ]);
      await connection.execute('DELETE FROM play_records WHERE username = ?', [
        username,
      ]);
      await connection.execute('DELETE FROM favorites WHERE username = ?', [
        username,
      ]);
      await connection.execute(
        'DELETE FROM search_history WHERE username = ?',
        [username],
      );
      await connection.execute('DELETE FROM skip_configs WHERE username = ?', [
        username,
      ]);
      await connection.execute(
        'DELETE FROM playback_sessions WHERE username = ?',
        [username],
      );
    });
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT keyword FROM search_history WHERE username = ? ORDER BY sort_index ASC',
      [username],
    );
    return rows.map((row) => row.keyword).filter(Boolean) as string[];
  }

  async addSearchHistory(
    userName: string,
    keyword: string,
    limit = SEARCH_HISTORY_LIMIT,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    const historyLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    await this.withTransaction(async (connection) => {
      await connection.execute(
        'DELETE FROM search_history WHERE username = ? AND keyword = ?',
        [username, keyword],
      );
      await connection.execute(
        'UPDATE search_history SET sort_index = sort_index + 1 WHERE username = ?',
        [username],
      );
      await connection.execute(
        'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, 0)',
        [username, keyword],
      );
      await connection.execute(
        'DELETE FROM search_history WHERE username = ? AND sort_index >= ?',
        [username, historyLimit],
      );
    });
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);

    if (!keyword) {
      await this.pool.execute('DELETE FROM search_history WHERE username = ?', [
        username,
      ]);
      return;
    }

    await this.pool.execute(
      'DELETE FROM search_history WHERE username = ? AND keyword = ?',
      [username, keyword],
    );
  }

  async getAllUsers(): Promise<string[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT username FROM users ORDER BY username ASC',
    );
    return rows.map((row) => row.username).filter(Boolean) as string[];
  }

  async getAllUsersWithPasswords(): Promise<{ [username: string]: string }> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT username, password FROM users ORDER BY username ASC',
    );
    const result: { [username: string]: string } = {};
    for (const row of rows) {
      if (row.username && row.password) {
        result[row.username] = row.password;
      }
    }
    return result;
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT config_json FROM admin_config WHERE id = 1 LIMIT 1',
    );
    const raw = rows[0]?.config_json;
    if (raw == null) {
      return null;
    }
    const parsed = parseJsonValue<AdminConfig>(raw);
    if (!parsed) {
      throw new Error('管理员配置解析失败');
    }
    return parsed;
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
    const username = normalizeUsername(userName);
    const key = `${source}+${id}`;
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT config_json FROM skip_configs WHERE username = ? AND config_key = ? LIMIT 1',
      [username, key],
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
    const username = normalizeUsername(userName);
    const key = `${source}+${id}`;
    await this.pool.execute(
      `INSERT INTO skip_configs (username, config_key, config_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)`,
      [username, key, JSON.stringify(config)],
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const key = `${source}+${id}`;
    await this.pool.execute(
      'DELETE FROM skip_configs WHERE username = ? AND config_key = ?',
      [username, key],
    );
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT config_key, config_json FROM skip_configs WHERE username = ?',
      [username],
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

  async setPlaybackSession(
    userName: string,
    session: PlaybackSession,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      `INSERT INTO playback_sessions (
        id, username, source, video_id, episode_index, title, source_name,
        cover, year, started_at, ended_at, watch_seconds, last_position,
        total_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        source = VALUES(source),
        video_id = VALUES(video_id),
        episode_index = VALUES(episode_index),
        title = VALUES(title),
        source_name = VALUES(source_name),
        cover = VALUES(cover),
        year = VALUES(year),
        started_at = VALUES(started_at),
        ended_at = VALUES(ended_at),
        watch_seconds = VALUES(watch_seconds),
        last_position = VALUES(last_position),
        total_time = VALUES(total_time),
        created_at = VALUES(created_at),
        updated_at = VALUES(updated_at)`,
      [
        session.id,
        username,
        session.source,
        session.video_id,
        session.episode_index,
        session.title,
        session.source_name,
        session.cover,
        session.year,
        session.started_at,
        session.ended_at,
        session.watch_seconds,
        session.last_position,
        session.total_time,
        session.created_at,
        session.updated_at,
      ],
    );
  }

  async getPlaybackSessions(
    userName: string,
    query: PlaybackSessionQuery = {},
  ): Promise<PlaybackSession[]> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const conditions = ['username = ?'];
    const params: Array<string | number> = [username];

    if (Number.isFinite(query.since)) {
      conditions.push('started_at >= ?');
      params.push(query.since as number);
    }

    if (Number.isFinite(query.cursor)) {
      conditions.push('started_at < ?');
      params.push(query.cursor as number);
    }

    const keyword = normalizePlaybackSearchKeyword(query.keyword);
    if (keyword) {
      const likePattern = buildPlaybackSearchLikePattern(keyword);
      conditions.push(
        "(title LIKE ? ESCAPE '!' OR source_name LIKE ? ESCAPE '!' OR year LIKE ? ESCAPE '!' OR video_id LIKE ? ESCAPE '!')",
      );
      params.push(likePattern, likePattern, likePattern, likePattern);
    }

    const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 500);
    params.push(limit);

    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT
        id, source, video_id, episode_index, title, source_name, cover, year,
        started_at, ended_at, watch_seconds, last_position, total_time,
        created_at, updated_at
      FROM playback_sessions
      WHERE ${conditions.join(' AND ')}
      ORDER BY started_at DESC
      LIMIT ?`,
      params,
    );

    return rows
      .filter((row) => row.id)
      .map((row) => ({
        id: row.id || '',
        source: row.source || '',
        video_id: row.video_id || '',
        episode_index: Number(row.episode_index || 0),
        title: row.title || '',
        source_name: row.source_name || '',
        cover: row.cover || '',
        year: row.year || '',
        started_at: Number(row.started_at || 0),
        ended_at: Number(row.ended_at || 0),
        watch_seconds: Number(row.watch_seconds || 0),
        last_position: Number(row.last_position || 0),
        total_time: Number(row.total_time || 0),
        created_at: Number(row.created_at || 0),
        updated_at: Number(row.updated_at || 0),
      }));
  }

  async deletePlaybackSession(userName: string, id: string): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      'DELETE FROM playback_sessions WHERE username = ? AND id = ?',
      [username, id],
    );
  }

  async getAllPlaybackSessions(userName: string): Promise<PlaybackSession[]> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT
        id, source, video_id, episode_index, title, source_name, cover, year,
        started_at, ended_at, watch_seconds, last_position, total_time,
        created_at, updated_at
      FROM playback_sessions
      WHERE username = ?
      ORDER BY started_at DESC`,
      [username],
    );

    return rows
      .filter((row) => row.id)
      .map((row) => ({
        id: row.id || '',
        source: row.source || '',
        video_id: row.video_id || '',
        episode_index: Number(row.episode_index || 0),
        title: row.title || '',
        source_name: row.source_name || '',
        cover: row.cover || '',
        year: row.year || '',
        started_at: Number(row.started_at || 0),
        ended_at: Number(row.ended_at || 0),
        watch_seconds: Number(row.watch_seconds || 0),
        last_position: Number(row.last_position || 0),
        total_time: Number(row.total_time || 0),
        created_at: Number(row.created_at || 0),
        updated_at: Number(row.updated_at || 0),
      }));
  }

  async getPlaybackWatchTotals(
    userName: string,
    since: number,
  ): Promise<PlaybackWatchTotals> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const periodStart = Number.isFinite(since)
      ? Math.max(0, Math.floor(since))
      : 0;
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT
        COALESCE(SUM(CASE WHEN watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS total_watch_seconds,
        COALESCE(SUM(CASE WHEN started_at >= ? AND watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS period_watch_seconds
      FROM playback_sessions
      WHERE username = ?`,
      [periodStart, username],
    );
    const row = rows[0];

    return {
      totalWatchSeconds: Number(row?.total_watch_seconds || 0),
      periodWatchSeconds: Number(row?.period_watch_seconds || 0),
    };
  }

  async getPlaybackRangeWatchTotals(
    userName: string,
    ranges: PlaybackTimeRange[],
  ): Promise<PlaybackRangeWatchTotal[]> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const result: PlaybackRangeWatchTotal[] = [];

    for (const range of ranges) {
      const start = Number.isFinite(range.start)
        ? Math.max(0, Math.floor(range.start))
        : 0;
      const end = Number.isFinite(range.end)
        ? Math.max(start, Math.floor(range.end))
        : start;
      const [rows] = await this.pool.query<JsonRow[]>(
        `SELECT COALESCE(SUM(CASE WHEN watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS watch_seconds
        FROM playback_sessions
        WHERE username = ? AND started_at >= ? AND started_at < ?`,
        [username, start, end],
      );

      result.push({
        key: range.key,
        watchSeconds: Number(rows[0]?.watch_seconds || 0),
      });
    }

    return result;
  }

  async getPlaybackTopItems(
    userName: string,
    limit = 6,
    since?: number,
  ): Promise<PlaybackStatsTopItem[]> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 20);
    const periodStart = Number.isFinite(since)
      ? Math.max(0, Math.floor(since as number))
      : null;
    const periodCondition = periodStart === null ? '' : ' AND started_at >= ?';
    const aggregateParams =
      periodStart === null
        ? [username, safeLimit]
        : [username, periodStart, safeLimit];
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT
        source,
        video_id,
        COALESCE(SUM(CASE WHEN watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS watch_seconds,
        COUNT(*) AS session_count,
        MAX(CASE WHEN ended_at > started_at THEN ended_at ELSE started_at END) AS last_watched_at
      FROM playback_sessions
      WHERE username = ?${periodCondition}
      GROUP BY source, video_id
      ORDER BY watch_seconds DESC, last_watched_at DESC
      LIMIT ?`,
      aggregateParams,
    );

    const items: PlaybackStatsTopItem[] = [];
    for (const row of rows) {
      const metadataParams =
        periodStart === null
          ? [username, row.source || '', row.video_id || '']
          : [username, row.source || '', row.video_id || '', periodStart];
      const [metadataRows] = await this.pool.query<JsonRow[]>(
        `SELECT title, source_name, cover, year
        FROM playback_sessions
        WHERE username = ? AND source = ? AND video_id = ?${periodCondition}
        ORDER BY started_at DESC
        LIMIT 1`,
        metadataParams,
      );
      const metadata = metadataRows[0];

      items.push({
        source: row.source || '',
        videoId: row.video_id || '',
        title: metadata?.title || '',
        sourceName: metadata?.source_name || '',
        cover: metadata?.cover || '',
        year: metadata?.year || '',
        watchSeconds: Number(row.watch_seconds || 0),
        sessionCount: Number(row.session_count || 0),
        lastWatchedAt: Number(row.last_watched_at || 0),
      });
    }

    return items;
  }

  async recordSourceRouteStat(input: SourceRouteStatInput): Promise<void> {
    await this.ensureInitialized();
    const source = input.source.trim().slice(0, 191);
    if (!source) return;
    const routeMode = input.routeMode === 'server' ? 'server' : 'browser';
    const eventAt = Number.isFinite(input.eventAt) ? input.eventAt : Date.now();
    const bucketDate = new Date(eventAt).toISOString().slice(0, 10);
    const successIncrement = input.success ? 1 : 0;
    const failureIncrement = input.success ? 0 : 1;

    await this.pool.execute(
      `INSERT INTO source_route_stats (
        source, route_mode, bucket_date, success_count, failure_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        success_count = success_count + VALUES(success_count),
        failure_count = failure_count + VALUES(failure_count),
        updated_at = VALUES(updated_at)`,
      [
        source,
        routeMode,
        bucketDate,
        successIncrement,
        failureIncrement,
        Date.now(),
      ],
    );
  }

  async getSourceRouteStats(
    sinceDate: string,
  ): Promise<SourceRouteStatsItem[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT
        source,
        route_mode,
        COALESCE(SUM(success_count), 0) AS success_count,
        COALESCE(SUM(failure_count), 0) AS failure_count
      FROM source_route_stats
      WHERE bucket_date >= ?
      GROUP BY source, route_mode`,
      [sinceDate],
    );

    return rows
      .filter(
        (row) => row.route_mode === 'browser' || row.route_mode === 'server',
      )
      .map((row) => ({
        source: row.source || '',
        routeMode: row.route_mode as SourceRouteStatsItem['routeMode'],
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }

  async getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT source, route_mode, bucket_date, success_count, failure_count
      FROM source_route_stats
      ORDER BY bucket_date ASC, source ASC, route_mode ASC`,
    );

    return rows
      .filter(
        (row) => row.route_mode === 'browser' || row.route_mode === 'server',
      )
      .map((row) => ({
        source: row.source || '',
        routeMode: row.route_mode as SourceRouteStatsBucket['routeMode'],
        bucketDate: row.bucket_date || '',
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }

  async clearAllData(): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM users');
      await connection.execute('DELETE FROM play_records');
      await connection.execute('DELETE FROM favorites');
      await connection.execute('DELETE FROM search_history');
      await connection.execute('DELETE FROM skip_configs');
      await connection.execute('DELETE FROM playback_sessions');
      await connection.execute('DELETE FROM admin_config');
      await connection.execute('DELETE FROM source_route_stats');
    });
  }

  async replaceAllData(data: StorageImportData): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM users');
      await connection.execute('DELETE FROM play_records');
      await connection.execute('DELETE FROM favorites');
      await connection.execute('DELETE FROM search_history');
      await connection.execute('DELETE FROM skip_configs');
      await connection.execute('DELETE FROM playback_sessions');
      await connection.execute('DELETE FROM admin_config');
      await connection.execute('DELETE FROM source_route_stats');

      await connection.execute(
        'INSERT INTO admin_config (id, config_json) VALUES (1, ?)',
        [JSON.stringify(data.adminConfig)],
      );

      const routeStatUpdatedAt = Date.now();
      for (const stat of data.sourceRouteStats) {
        await connection.execute(
          `INSERT INTO source_route_stats (
            source, route_mode, bucket_date, success_count, failure_count, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            stat.source,
            stat.routeMode,
            stat.bucketDate,
            stat.successCount,
            stat.failureCount,
            routeStatUpdatedAt,
          ],
        );
      }

      for (const [userName, passwordHash] of Object.entries(data.users)) {
        const username = assertValidUsernameFormat(userName);
        await connection.execute(
          'INSERT INTO users (username, password) VALUES (?, ?)',
          [username, passwordHash],
        );
      }

      for (const [userName, userData] of Object.entries(data.userData)) {
        const username = assertValidUsernameFormat(userName);
        for (const [key, record] of Object.entries(userData.playRecords)) {
          await connection.execute(
            'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
            [username, key, JSON.stringify(record)],
          );
        }

        for (const [key, favorite] of Object.entries(userData.favorites)) {
          await connection.execute(
            'INSERT INTO favorites (username, favorite_key, favorite_json) VALUES (?, ?, ?)',
            [username, key, JSON.stringify(favorite)],
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
            [username, keyword, index],
          );
        }

        for (const [key, config] of Object.entries(userData.skipConfigs)) {
          await connection.execute(
            'INSERT INTO skip_configs (username, config_key, config_json) VALUES (?, ?, ?)',
            [username, key, JSON.stringify(config)],
          );
        }

        for (const session of Object.values(userData.playbackSessions)) {
          await connection.execute(
            `INSERT INTO playback_sessions (
              id, username, source, video_id, episode_index, title, source_name,
              cover, year, started_at, ended_at, watch_seconds, last_position,
              total_time, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              session.id,
              username,
              session.source,
              session.video_id,
              session.episode_index,
              session.title,
              session.source_name,
              session.cover,
              session.year,
              session.started_at,
              session.ended_at,
              session.watch_seconds,
              session.last_position,
              session.total_time,
              session.created_at,
              session.updated_at,
            ],
          );
        }
      }
    });
  }
}
