import 'server-only';

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

import { AdminConfig } from '@/types/admin';

import { hashPassword, verifyPassword } from './password';
import {
  buildPlaybackSearchLikePattern,
  normalizePlaybackSearchKeyword,
} from './playback-query';
import { buildTrackingSql, SQLITE_TRACKING_DIALECT } from './tracking-sql';
import {
  Favorite,
  FavoritePage,
  IStorage,
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
import { assertValidUsernameFormat, normalizeUsername } from './username';
import {
  mergeSearchKeywords,
  pickNewerJson,
  planUsernameMigration,
} from './username-migration';

const SEARCH_HISTORY_LIMIT = 20;

const {
  createdAt: SQLITE_TRACKING_CREATED_AT,
  unreadWhere: SQLITE_UNREAD_TRACKING_WHERE,
} = buildTrackingSql(SQLITE_TRACKING_DIALECT);

function parseBusyTimeoutMs(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
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

function isSqliteUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: string }).code;
  return (
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    /unique constraint failed/i.test(error.message)
  );
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

type PlaybackWatchTotalsRow = {
  total_watch_seconds: number | null;
  period_watch_seconds: number | null;
};

type PlaybackTopItemRow = {
  source: string;
  video_id: string;
  title: string | null;
  source_name: string | null;
  cover: string | null;
  year: string | null;
  watch_seconds: number | null;
  session_count: number | null;
  last_watched_at: number | null;
};

type SourceRouteStatsRow = {
  source: string;
  route_mode: string;
  success_count: number | null;
  failure_count: number | null;
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

function buildPlayRecordPage(
  rows: Array<{ record_key: string; record_json: string }>,
  total: number,
  limit: number,
): PlayRecordPage {
  const pageRows = rows.slice(0, limit);
  const items: Record<string, PlayRecord> = {};
  for (const row of pageRows) {
    const parsed = parseJsonValue<PlayRecord>(row.record_json);
    if (parsed) items[row.record_key] = parsed;
  }
  const lastRow = pageRows.at(-1);
  const lastRecord = lastRow ? items[lastRow.record_key] : null;
  return {
    items,
    total,
    nextCursor:
      rows.length > limit && lastRow && lastRecord
        ? `${lastRecord.save_time}|${lastRow.record_key}`
        : null,
  };
}

function buildTrackingPlayRecordPage(
  rows: Array<{ record_key: string; record_json: string }>,
  total: number,
  limit: number,
): PlayRecordPage {
  const pageRows = rows.slice(0, limit);
  const items: Record<string, PlayRecord> = {};
  for (const row of pageRows) {
    const parsed = parseJsonValue<PlayRecord>(row.record_json);
    if (parsed) items[row.record_key] = parsed;
  }
  const lastRow = pageRows.at(-1);
  const lastRecord = lastRow ? items[lastRow.record_key] : null;
  const lastCreatedAt = lastRecord
    ? lastRecord.update_detected_at ||
      lastRecord.metadata_checked_at ||
      lastRecord.save_time
    : null;
  return {
    items,
    total,
    nextCursor:
      rows.length > limit && lastRow && lastCreatedAt !== null
        ? `${lastCreatedAt}|${lastRow.record_key}`
        : null,
  };
}

function buildFavoritePage(
  rows: Array<{
    favorite_key: string;
    favorite_json: string;
    record_json?: string | null;
  }>,
  total: number,
  limit: number,
): FavoritePage {
  const items = rows.slice(0, limit).flatMap((row) => {
    const favorite = parseJsonValue<Favorite>(row.favorite_json);
    if (!favorite) return [];
    const playRecord = parseJsonValue<PlayRecord>(row.record_json);
    return [
      {
        key: row.favorite_key,
        favorite,
        ...(playRecord ? { playRecord } : {}),
      },
    ];
  });
  const lastItem = items.at(-1);
  return {
    items,
    total,
    nextCursor:
      rows.length > limit && lastItem
        ? `${lastItem.favorite.save_time}|${lastItem.key}`
        : null,
  };
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
    getPlayRecordPage: Database.Statement;
    getPlayRecordPageAfter: Database.Statement;
    countPlayRecords: Database.Statement;
    getUnreadTrackingPlayRecordPage: Database.Statement;
    getUnreadTrackingPlayRecordPageAfter: Database.Statement;
    countUnreadTrackingPlayRecords: Database.Statement;
    deletePlayRecord: Database.Statement;
    // favorites
    getFavorite: Database.Statement;
    setFavorite: Database.Statement;
    getAllFavorites: Database.Statement;
    getFavoritePage: Database.Statement;
    getFavoritePageAfter: Database.Statement;
    countFavorites: Database.Statement;
    deleteFavorite: Database.Statement;
    // users
    registerUser: Database.Statement;
    getPassword: Database.Statement;
    updatePassword: Database.Statement;
    checkUserExist: Database.Statement;
    deleteUserRow: Database.Statement;
    getAllUsers: Database.Statement;
    getAllUsersWithPasswords: Database.Statement;
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
    setPlaybackSession: Database.Statement;
    deletePlaybackSession: Database.Statement;
    deletePlaybackSessionsBefore: Database.Statement;
    // admin_config
    getAdminConfig: Database.Statement;
    setAdminConfig: Database.Statement;
    // delete by username (for deleteUser transaction)
    deletePlayRecordsByUser: Database.Statement;
    deleteFavoritesByUser: Database.Statement;
    deleteSearchHistoryByUser: Database.Statement;
    deleteSkipConfigsByUser: Database.Statement;
    deletePlaybackSessionsByUser: Database.Statement;
    getUserMessageState: Database.Statement;
    setUserMessageState: Database.Statement;
    deleteUserMessageStateByUser: Database.Statement;
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
      dbPath || process.env.LOCAL_DB_PATH || defaultSqlitePath;

    const isMemoryDb = configuredPath === ':memory:';
    const isLegacyJsonPath = configuredPath.toLowerCase().endsWith('.json');
    this.dbPath = isMemoryDb
      ? configuredPath
      : isLegacyJsonPath
        ? configuredPath.replace(/\.json$/i, '.sqlite')
        : configuredPath;

    const candidates = [defaultJsonPath, legacyJsonPath];
    if (!isMemoryDb && isLegacyJsonPath) {
      candidates.unshift(configuredPath);
    }
    this.legacyJsonPaths = isMemoryDb ? [] : Array.from(new Set(candidates));

    if (!isMemoryDb) {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    const busyTimeoutMs = parseBusyTimeoutMs(
      process.env.SQLITE_BUSY_TIMEOUT_MS,
      5000,
    );
    this.db = runWithBusyRetry('打开 SQLite 数据库', () => {
      return new Database(this.dbPath, { timeout: busyTimeoutMs });
    });
    runWithBusyRetry('初始化 SQLite 数据库', () => {
      if (!isMemoryDb) {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        const mmapBytes = parseNonNegativeInt(
          process.env.SQLITE_MMAP_SIZE_BYTES,
          128 * 1024 * 1024,
        );
        if (mmapBytes > 0) {
          this.db.pragma(`mmap_size = ${mmapBytes}`);
        }
      }
      const cacheSizeKib = parseNonNegativeInt(
        process.env.SQLITE_CACHE_SIZE_KIB,
        16 * 1024,
      );
      if (cacheSizeKib > 0) {
        this.db.pragma(`cache_size = -${cacheSizeKib}`);
      }
      this.db.pragma('temp_store = MEMORY');
      this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
      this.initializeSchema();
    });
    this.stmts = this.prepareStatements();
    if (!isMemoryDb) {
      runWithBusyRetry('迁移 SQLite 历史数据', () => {
        this.migrateFromLegacyJsonIfNeeded();
      });
      runWithBusyRetry('归一化 SQLite 用户名', () => {
        this.migrateLegacyUsernameCasing();
      });
      this.checkpointWal();
    }
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

      CREATE TABLE IF NOT EXISTS playback_sessions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        source TEXT NOT NULL,
        video_id TEXT NOT NULL,
        episode_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        source_name TEXT NOT NULL,
        cover TEXT NOT NULL,
        year TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        watch_seconds INTEGER NOT NULL,
        last_position INTEGER NOT NULL,
        total_time INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_playback_sessions_user_started_at
        ON playback_sessions (username, started_at);

      CREATE INDEX IF NOT EXISTS idx_playback_sessions_user_video
        ON playback_sessions (username, source, video_id);

      CREATE INDEX IF NOT EXISTS idx_playback_sessions_updated_at
        ON playback_sessions (updated_at);

      CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        config_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_message_state (
        username TEXT PRIMARY KEY,
        state_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_route_stats (
        source TEXT NOT NULL,
        route_mode TEXT NOT NULL,
        bucket_date TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source, route_mode, bucket_date)
      );

      CREATE INDEX IF NOT EXISTS idx_source_route_stats_bucket
        ON source_route_stats (bucket_date);
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
      getPlayRecordPage: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ?
         ORDER BY CAST(json_extract(record_json, '$.save_time') AS INTEGER) DESC,
                  record_key DESC
         LIMIT ?`,
      ),
      getPlayRecordPageAfter: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ?
           AND (
             CAST(json_extract(record_json, '$.save_time') AS INTEGER) < ?
             OR (
               CAST(json_extract(record_json, '$.save_time') AS INTEGER) = ?
               AND record_key < ?
             )
           )
         ORDER BY CAST(json_extract(record_json, '$.save_time') AS INTEGER) DESC,
                  record_key DESC
         LIMIT ?`,
      ),
      countPlayRecords: this.db.prepare(
        'SELECT COUNT(*) AS count FROM play_records WHERE username = ?',
      ),
      getUnreadTrackingPlayRecordPage: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ? AND ${SQLITE_UNREAD_TRACKING_WHERE}
         ORDER BY ${SQLITE_TRACKING_CREATED_AT} DESC, record_key DESC
         LIMIT ?`,
      ),
      getUnreadTrackingPlayRecordPageAfter: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ?
           AND ${SQLITE_UNREAD_TRACKING_WHERE}
           AND (
             ${SQLITE_TRACKING_CREATED_AT} < ?
             OR (
               ${SQLITE_TRACKING_CREATED_AT} = ?
               AND record_key < ?
             )
           )
         ORDER BY ${SQLITE_TRACKING_CREATED_AT} DESC, record_key DESC
         LIMIT ?`,
      ),
      countUnreadTrackingPlayRecords: this.db.prepare(
        `SELECT COUNT(*) AS count
         FROM play_records
         WHERE username = ? AND ${SQLITE_UNREAD_TRACKING_WHERE}`,
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
      getFavoritePage: this.db.prepare(
        `SELECT f.favorite_key, f.favorite_json, p.record_json
         FROM favorites f
         LEFT JOIN play_records p
           ON p.username = f.username AND p.record_key = f.favorite_key
         WHERE f.username = ?
         ORDER BY CAST(json_extract(f.favorite_json, '$.save_time') AS INTEGER) DESC,
                  f.favorite_key DESC
         LIMIT ?`,
      ),
      getFavoritePageAfter: this.db.prepare(
        `SELECT f.favorite_key, f.favorite_json, p.record_json
         FROM favorites f
         LEFT JOIN play_records p
           ON p.username = f.username AND p.record_key = f.favorite_key
         WHERE f.username = ?
           AND (
             CAST(json_extract(f.favorite_json, '$.save_time') AS INTEGER) < ?
             OR (
               CAST(json_extract(f.favorite_json, '$.save_time') AS INTEGER) = ?
               AND f.favorite_key < ?
             )
           )
         ORDER BY CAST(json_extract(f.favorite_json, '$.save_time') AS INTEGER) DESC,
                  f.favorite_key DESC
         LIMIT ?`,
      ),
      countFavorites: this.db.prepare(
        'SELECT COUNT(*) AS count FROM favorites WHERE username = ?',
      ),
      deleteFavorite: this.db.prepare(
        'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
      ),
      // users
      registerUser: this.db.prepare(
        'INSERT INTO users (username, password) VALUES (?, ?)',
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
      getAllUsersWithPasswords: this.db.prepare(
        'SELECT username, password FROM users ORDER BY username ASC',
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
      setPlaybackSession: this.db.prepare(
        `INSERT INTO playback_sessions (
          id, username, source, video_id, episode_index, title, source_name,
          cover, year, started_at, ended_at, watch_seconds, last_position,
          total_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          source = excluded.source,
          video_id = excluded.video_id,
          episode_index = excluded.episode_index,
          title = excluded.title,
          source_name = excluded.source_name,
          cover = excluded.cover,
          year = excluded.year,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          watch_seconds = excluded.watch_seconds,
          last_position = excluded.last_position,
          total_time = excluded.total_time,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      ),
      deletePlaybackSession: this.db.prepare(
        'DELETE FROM playback_sessions WHERE username = ? AND id = ?',
      ),
      deletePlaybackSessionsBefore: this.db.prepare(
        'DELETE FROM playback_sessions WHERE updated_at < ?',
      ),
      // admin_config
      getAdminConfig: this.db.prepare(
        'SELECT config_json FROM admin_config WHERE id = 1',
      ),
      setAdminConfig: this.db.prepare(
        'INSERT OR REPLACE INTO admin_config (id, config_json) VALUES (1, ?)',
      ),
      getUserMessageState: this.db.prepare(
        'SELECT state_json FROM user_message_state WHERE username = ?',
      ),
      setUserMessageState: this.db.prepare(
        'INSERT OR REPLACE INTO user_message_state (username, state_json) VALUES (?, ?)',
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
      deletePlaybackSessionsByUser: this.db.prepare(
        'DELETE FROM playback_sessions WHERE username = ?',
      ),
      deleteUserMessageStateByUser: this.db.prepare(
        'DELETE FROM user_message_state WHERE username = ?',
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
      'SELECT 1 AS v FROM playback_sessions LIMIT 1',
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
        const username = assertValidUsernameFormat(userName);
        insertUser.run(username, password);
      }

      for (const [userName, records] of Object.entries(
        legacyData.playRecords,
      )) {
        const username = assertValidUsernameFormat(userName);
        for (const [key, record] of Object.entries(records)) {
          insertPlayRecord.run(username, key, JSON.stringify(record));
        }
      }

      for (const [userName, favorites] of Object.entries(
        legacyData.favorites,
      )) {
        const username = assertValidUsernameFormat(userName);
        for (const [key, favorite] of Object.entries(favorites)) {
          insertFavorite.run(username, key, JSON.stringify(favorite));
        }
      }

      for (const [userName, keywords] of Object.entries(
        legacyData.searchHistory,
      )) {
        const username = assertValidUsernameFormat(userName);
        if (!Array.isArray(keywords)) {
          continue;
        }
        keywords.slice(0, SEARCH_HISTORY_LIMIT).forEach((keyword, index) => {
          insertHistory.run(username, keyword, index);
        });
      }

      for (const [userName, configs] of Object.entries(
        legacyData.skipConfigs,
      )) {
        const username = assertValidUsernameFormat(userName);
        for (const [key, config] of Object.entries(configs)) {
          insertSkipConfig.run(username, key, JSON.stringify(config));
        }
      }

      if (legacyData.adminConfig) {
        insertAdminConfig.run(JSON.stringify(legacyData.adminConfig));
      }
    });

    migrate();
    console.log(`检测到旧 JSON 数据，已迁移到 SQLite: ${this.dbPath}`);
  }

  // 归一化上线前写入的大小写混杂用户名，否则查询侧归一化后永远匹配不到这些行
  private migrateLegacyUsernameCasing(): void {
    const usernames = this.collectDistinctUsernames();
    const plan = planUsernameMigration(usernames);
    if (plan.length === 0) {
      return;
    }

    const migrate = this.db.transaction(() => {
      for (const { legacy, canonical } of plan) {
        this.mergeUserRow(legacy, canonical);
        this.mergeKeyedTable(
          'play_records',
          'record_key',
          'record_json',
          legacy,
          canonical,
        );
        this.mergeKeyedTable(
          'favorites',
          'favorite_key',
          'favorite_json',
          legacy,
          canonical,
        );
        this.mergeKeyedTable(
          'skip_configs',
          'config_key',
          'config_json',
          legacy,
          canonical,
        );
        this.mergeSearchHistory(legacy, canonical);
        this.mergeSingleRowTable(
          'user_message_state',
          'state_json',
          legacy,
          canonical,
        );
        this.db
          .prepare(
            'UPDATE playback_sessions SET username = ? WHERE username = ?',
          )
          .run(canonical, legacy);
      }
    });

    migrate();
    const detail = plan
      .map(({ legacy, canonical }) => `${legacy} -> ${canonical}`)
      .join(', ');
    console.log(`已归一化 SQLite 遗留用户名: ${detail}`);
  }

  private collectDistinctUsernames(): string[] {
    const tables = [
      'users',
      'play_records',
      'favorites',
      'search_history',
      'skip_configs',
      'playback_sessions',
      'user_message_state',
    ];
    const usernames = new Set<string>();
    for (const table of tables) {
      const rows = this.db
        .prepare(`SELECT DISTINCT username FROM ${table}`)
        .all() as { username: string }[];
      for (const row of rows) {
        if (row.username) {
          usernames.add(row.username);
        }
      }
    }
    return [...usernames];
  }

  // 规范行已存在时保留其密码，避免覆盖用户当前在用的凭据
  private mergeUserRow(legacy: string, canonical: string): void {
    this.db
      .prepare(
        `INSERT INTO users (username, password)
         SELECT ?, password FROM users WHERE username = ?
         ON CONFLICT(username) DO NOTHING`,
      )
      .run(canonical, legacy);
    this.db.prepare('DELETE FROM users WHERE username = ?').run(legacy);
  }

  private mergeKeyedTable(
    table: string,
    keyColumn: string,
    jsonColumn: string,
    legacy: string,
    canonical: string,
  ): void {
    const legacyRows = this.db
      .prepare(
        `SELECT ${keyColumn} AS key, ${jsonColumn} AS json FROM ${table} WHERE username = ?`,
      )
      .all(legacy) as { key: string; json: string }[];
    if (legacyRows.length === 0) {
      return;
    }

    const readCanonical = this.db.prepare(
      `SELECT ${jsonColumn} AS json FROM ${table} WHERE username = ? AND ${keyColumn} = ?`,
    );
    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO ${table} (username, ${keyColumn}, ${jsonColumn}) VALUES (?, ?, ?)`,
    );
    for (const row of legacyRows) {
      const canonicalRow = readCanonical.get(canonical, row.key) as
        | { json: string }
        | undefined;
      upsert.run(
        canonical,
        row.key,
        pickNewerJson(canonicalRow?.json, row.json),
      );
    }
    this.db.prepare(`DELETE FROM ${table} WHERE username = ?`).run(legacy);
  }

  private mergeSearchHistory(legacy: string, canonical: string): void {
    const readKeywords = this.db.prepare(
      'SELECT keyword FROM search_history WHERE username = ? ORDER BY sort_index ASC',
    );
    const legacyKeywords = (
      readKeywords.all(legacy) as { keyword: string }[]
    ).map((row) => row.keyword);
    if (legacyKeywords.length === 0) {
      return;
    }

    const canonicalKeywords = (
      readKeywords.all(canonical) as { keyword: string }[]
    ).map((row) => row.keyword);
    const merged = mergeSearchKeywords(
      canonicalKeywords,
      legacyKeywords,
      SEARCH_HISTORY_LIMIT,
    );

    this.db
      .prepare('DELETE FROM search_history WHERE username IN (?, ?)')
      .run(legacy, canonical);
    const insert = this.db.prepare(
      'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, ?)',
    );
    merged.forEach((keyword, index) => insert.run(canonical, keyword, index));
  }

  private mergeSingleRowTable(
    table: string,
    jsonColumn: string,
    legacy: string,
    canonical: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table} (username, ${jsonColumn})
         SELECT ?, ${jsonColumn} FROM ${table} WHERE username = ?
         ON CONFLICT(username) DO NOTHING`,
      )
      .run(canonical, legacy);
    this.db.prepare(`DELETE FROM ${table} WHERE username = ?`).run(legacy);
  }

  private checkpointWal(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      console.warn('SQLite WAL checkpoint 失败:', error);
    }
  }

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getPlayRecord.get(username, key) as
      | { record_json: string }
      | undefined;
    return parseJsonValue<PlayRecord>(row?.record_json);
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.setPlayRecord.run(username, key, JSON.stringify(record));
  }

  async setPlayRecords(
    userName: string,
    records: Record<string, PlayRecord>,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    const entries = Object.entries(records);
    if (entries.length === 0) return;
    const save = this.db.transaction(
      (targetUser: string, targetEntries: Array<[string, PlayRecord]>) => {
        for (const [key, record] of targetEntries) {
          this.stmts.setPlayRecord.run(targetUser, key, JSON.stringify(record));
        }
      },
    );
    save(username, entries);
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    const username = normalizeUsername(userName);
    const rows = this.stmts.getAllPlayRecords.all(username) as {
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

  async getPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage> {
    const username = normalizeUsername(userName);
    const rows = (
      cursorTime !== undefined && cursorKey
        ? this.stmts.getPlayRecordPageAfter.all(
            username,
            cursorTime,
            cursorTime,
            cursorKey,
            limit + 1,
          )
        : this.stmts.getPlayRecordPage.all(username, limit + 1)
    ) as { record_key: string; record_json: string }[];
    const countRow = this.stmts.countPlayRecords.get(username) as {
      count: number;
    };
    return buildPlayRecordPage(rows, countRow.count, limit);
  }

  async getUnreadTrackingPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage> {
    const username = normalizeUsername(userName);
    const rows = (
      cursorTime !== undefined && cursorKey
        ? this.stmts.getUnreadTrackingPlayRecordPageAfter.all(
            username,
            cursorTime,
            cursorTime,
            cursorKey,
            limit + 1,
          )
        : this.stmts.getUnreadTrackingPlayRecordPage.all(username, limit + 1)
    ) as Array<{ record_key: string; record_json: string }>;
    const countRow = this.stmts.countUnreadTrackingPlayRecords.get(
      username,
    ) as { count: number };
    return buildTrackingPlayRecordPage(rows, countRow.count, limit);
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deletePlayRecord.run(username, key);
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deletePlayRecordsByUser.run(username);
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getFavorite.get(username, key) as
      | { favorite_json: string }
      | undefined;
    return parseJsonValue<Favorite>(row?.favorite_json);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.setFavorite.run(username, key, JSON.stringify(favorite));
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    const username = normalizeUsername(userName);
    const rows = this.stmts.getAllFavorites.all(username) as {
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

  async getFavoritePage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<FavoritePage> {
    const username = normalizeUsername(userName);
    const rows = (
      cursorTime !== undefined && cursorKey
        ? this.stmts.getFavoritePageAfter.all(
            username,
            cursorTime,
            cursorTime,
            cursorKey,
            limit + 1,
          )
        : this.stmts.getFavoritePage.all(username, limit + 1)
    ) as Array<{
      favorite_key: string;
      favorite_json: string;
      record_json?: string | null;
    }>;
    const countRow = this.stmts.countFavorites.get(username) as {
      count: number;
    };
    return buildFavoritePage(rows, countRow.count, limit);
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deleteFavorite.run(username, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deleteFavoritesByUser.run(username);
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const username = assertValidUsernameFormat(userName);
    if (this.stmts.checkUserExist.get(username)) {
      throw new Error('用户已存在');
    }
    const hashed = await hashPassword(password);
    try {
      this.stmts.registerUser.run(username, hashed);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error)) {
        throw new Error('用户已存在');
      }
      throw error;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getPassword.get(username) as
      | { password: string }
      | undefined;
    if (!row) return false;

    const { match, needsRehash } = await verifyPassword(password, row.password);
    if (match && needsRehash) {
      const hashed = await hashPassword(password);
      this.stmts.updatePassword.run(hashed, username);
    }
    return match;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const username = normalizeUsername(userName);
    return Boolean(this.stmts.checkUserExist.get(username));
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const username = normalizeUsername(userName);
    const hashed = await hashPassword(newPassword);
    this.stmts.updatePassword.run(hashed, username);
  }

  async deleteUser(userName: string): Promise<void> {
    const username = normalizeUsername(userName);
    const remove = this.db.transaction((targetUser: string) => {
      this.stmts.deleteUserRow.run(targetUser);
      this.stmts.deletePlayRecordsByUser.run(targetUser);
      this.stmts.deleteFavoritesByUser.run(targetUser);
      this.stmts.deleteSearchHistoryByUser.run(targetUser);
      this.stmts.deleteSkipConfigsByUser.run(targetUser);
      this.stmts.deletePlaybackSessionsByUser.run(targetUser);
      this.stmts.deleteUserMessageStateByUser.run(targetUser);
    });
    remove(username);
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const username = normalizeUsername(userName);
    const rows = this.stmts.getSearchHistory.all(username) as {
      keyword: string;
    }[];
    return rows.map((row) => row.keyword);
  }

  async addSearchHistory(
    userName: string,
    keyword: string,
    limit = SEARCH_HISTORY_LIMIT,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    const historyLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    const save = this.db.transaction((targetUser: string, kw: string) => {
      this.stmts.deleteSearchHistoryKeyword.run(targetUser, kw);
      this.stmts.updateSearchHistoryIndex.run(targetUser);
      this.stmts.insertSearchHistory.run(targetUser, kw, 0);
      this.stmts.deleteSearchHistoryOverflow.run(targetUser, historyLimit);
    });
    save(username, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const username = normalizeUsername(userName);
    if (!keyword) {
      this.stmts.deleteSearchHistoryAll.run(username);
      return;
    }
    this.stmts.deleteSearchHistoryOne.run(username, keyword);
  }

  async getAllUsers(): Promise<string[]> {
    const rows = this.stmts.getAllUsers.all() as { username: string }[];
    return [...new Set(rows.map((row) => normalizeUsername(row.username)))];
  }

  async getAllUsersWithPasswords(): Promise<{ [username: string]: string }> {
    const rows = this.stmts.getAllUsersWithPasswords.all() as {
      username: string;
      password: string;
    }[];
    const result: { [username: string]: string } = {};
    for (const row of rows) {
      if (row.username && row.password) {
        result[normalizeUsername(row.username)] = row.password;
      }
    }
    return result;
  }

  async getUserMessageState(userName: string): Promise<UserMessageState> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getUserMessageState.get(username) as
      | { state_json: string }
      | undefined;
    return parseJsonValue<UserMessageState>(row?.state_json) || {};
  }

  async setUserMessageState(
    userName: string,
    state: UserMessageState,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.setUserMessageState.run(username, JSON.stringify(state));
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const row = this.stmts.getAdminConfig.get() as
      | { config_json: string }
      | undefined;
    if (!row) {
      return null;
    }
    const parsed = parseJsonValue<AdminConfig>(row.config_json);
    if (!parsed) {
      throw new Error('管理员配置解析失败');
    }
    return parsed;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    this.stmts.setAdminConfig.run(JSON.stringify(config));
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const username = normalizeUsername(userName);
    const key = `${source}+${id}`;
    const row = this.stmts.getSkipConfig.get(username, key) as
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
    const username = normalizeUsername(userName);
    const key = `${source}+${id}`;
    this.stmts.setSkipConfig.run(username, key, JSON.stringify(config));
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    const key = `${source}+${id}`;
    this.stmts.deleteSkipConfig.run(username, key);
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    const username = normalizeUsername(userName);
    const rows = this.stmts.getAllSkipConfigs.all(username) as {
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

  async setPlaybackSession(
    userName: string,
    session: PlaybackSession,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.setPlaybackSession.run(
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
    );
  }

  async getPlaybackSessions(
    userName: string,
    query: PlaybackSessionQuery = {},
  ): Promise<PlaybackSession[]> {
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

    const rows = this.db
      .prepare(
        `SELECT
          id, source, video_id, episode_index, title, source_name, cover, year,
          started_at, ended_at, watch_seconds, last_position, total_time,
          created_at, updated_at
        FROM playback_sessions
        WHERE ${conditions.join(' AND ')}
        ORDER BY started_at DESC
        LIMIT ?`,
      )
      .all(...params) as PlaybackSession[];

    return rows;
  }

  async getAllPlaybackSessions(userName: string): Promise<PlaybackSession[]> {
    const username = normalizeUsername(userName);
    const rows = this.db
      .prepare(
        `SELECT
          id, source, video_id, episode_index, title, source_name, cover, year,
          started_at, ended_at, watch_seconds, last_position, total_time,
          created_at, updated_at
        FROM playback_sessions
        WHERE username = ?
        ORDER BY started_at DESC`,
      )
      .all(username) as PlaybackSession[];

    return rows;
  }

  async deletePlaybackSession(userName: string, id: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deletePlaybackSession.run(username, id);
  }

  async deletePlaybackSessionsBefore(updatedBefore: number): Promise<number> {
    const cutoff = Number.isFinite(updatedBefore)
      ? Math.max(0, Math.floor(updatedBefore))
      : 0;
    const result = this.stmts.deletePlaybackSessionsBefore.run(cutoff);
    return Number(result.changes || 0);
  }

  async getPlaybackWatchTotals(
    userName: string,
    since: number,
  ): Promise<PlaybackWatchTotals> {
    const username = normalizeUsername(userName);
    const periodStart = Number.isFinite(since)
      ? Math.max(0, Math.floor(since))
      : 0;
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS total_watch_seconds,
          COALESCE(SUM(CASE WHEN started_at >= ? AND watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS period_watch_seconds
        FROM playback_sessions
        WHERE username = ?`,
      )
      .get(periodStart, username) as PlaybackWatchTotalsRow | undefined;

    return {
      totalWatchSeconds: Number(row?.total_watch_seconds || 0),
      periodWatchSeconds: Number(row?.period_watch_seconds || 0),
    };
  }

  async getPlaybackRangeWatchTotals(
    userName: string,
    ranges: PlaybackTimeRange[],
  ): Promise<PlaybackRangeWatchTotal[]> {
    const username = normalizeUsername(userName);
    if (ranges.length === 0) return [];

    const normalizedRanges = ranges.map((range) => {
      const start = Number.isFinite(range.start)
        ? Math.max(0, Math.floor(range.start))
        : 0;
      const end = Number.isFinite(range.end)
        ? Math.max(start, Math.floor(range.end))
        : start;
      return { key: range.key, start, end };
    });
    const rangeExpressions = normalizedRanges.map(
      (_, index) =>
        `COALESCE(SUM(CASE WHEN started_at >= ? AND started_at < ? AND watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS range_${index}`,
    );
    const rangeParams = normalizedRanges.flatMap(({ start, end }) => [
      start,
      end,
    ]);
    const scanStart = Math.min(...normalizedRanges.map(({ start }) => start));
    const scanEnd = Math.max(...normalizedRanges.map(({ end }) => end));
    const row = this.db
      .prepare(
        `SELECT ${rangeExpressions.join(', ')}
        FROM playback_sessions
        WHERE username = ? AND started_at >= ? AND started_at < ?`,
      )
      .get(...rangeParams, username, scanStart, scanEnd) as
      | Record<string, number | null>
      | undefined;

    return normalizedRanges.map((range, index) => ({
      key: range.key,
      watchSeconds: Number(row?.[`range_${index}`] || 0),
    }));
  }

  async getPlaybackTopItems(
    userName: string,
    limit = 6,
    since?: number,
  ): Promise<PlaybackStatsTopItem[]> {
    const username = normalizeUsername(userName);
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 20);
    const periodStart = Number.isFinite(since)
      ? Math.max(0, Math.floor(since as number))
      : null;
    const periodCondition = periodStart === null ? '' : ' AND started_at >= ?';
    const queryParams =
      periodStart === null
        ? [username, safeLimit]
        : [username, periodStart, safeLimit];
    const rows = this.db
      .prepare(
        `WITH normalized_sessions AS (
          SELECT
            id,
            source,
            video_id,
            title,
            source_name,
            cover,
            year,
            started_at,
            ended_at,
            watch_seconds,
            CASE
              WHEN TRIM(title) <> '' THEN LOWER(TRIM(title))
              ELSE source || ':' || video_id
            END AS title_key
          FROM playback_sessions
          WHERE username = ?${periodCondition}
        ),
        ranked_sessions AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY title_key
              ORDER BY started_at DESC, id DESC
            ) AS metadata_rank
          FROM normalized_sessions
        )
        SELECT
          MAX(CASE WHEN metadata_rank = 1 THEN source END) AS source,
          MAX(CASE WHEN metadata_rank = 1 THEN video_id END) AS video_id,
          MAX(CASE WHEN metadata_rank = 1 THEN title END) AS title,
          MAX(CASE WHEN metadata_rank = 1 THEN source_name END) AS source_name,
          MAX(CASE WHEN metadata_rank = 1 THEN cover END) AS cover,
          MAX(CASE WHEN metadata_rank = 1 THEN year END) AS year,
          COALESCE(SUM(CASE WHEN watch_seconds > 0 THEN watch_seconds ELSE 0 END), 0) AS watch_seconds,
          COUNT(*) AS session_count,
          MAX(CASE WHEN ended_at > started_at THEN ended_at ELSE started_at END) AS last_watched_at
        FROM ranked_sessions
        GROUP BY title_key
        ORDER BY watch_seconds DESC, last_watched_at DESC
        LIMIT ?`,
      )
      .all(...queryParams) as PlaybackTopItemRow[];

    return rows.map((row) => ({
      source: row.source,
      videoId: row.video_id,
      title: row.title || '',
      sourceName: row.source_name || '',
      cover: row.cover || '',
      year: row.year || '',
      watchSeconds: Number(row.watch_seconds || 0),
      sessionCount: Number(row.session_count || 0),
      lastWatchedAt: Number(row.last_watched_at || 0),
    }));
  }

  async recordSourceRouteStat(input: SourceRouteStatInput): Promise<void> {
    const source = input.source.trim().slice(0, 191);
    if (!source) return;
    const routeMode = input.routeMode === 'server' ? 'server' : 'browser';
    const eventAt = Number.isFinite(input.eventAt) ? input.eventAt : Date.now();
    const bucketDate = new Date(eventAt).toISOString().slice(0, 10);
    const successIncrement = input.success ? 1 : 0;
    const failureIncrement = input.success ? 0 : 1;

    this.db
      .prepare(
        `INSERT INTO source_route_stats (
          source, route_mode, bucket_date, success_count, failure_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, route_mode, bucket_date) DO UPDATE SET
          success_count = success_count + excluded.success_count,
          failure_count = failure_count + excluded.failure_count,
          updated_at = excluded.updated_at`,
      )
      .run(
        source,
        routeMode,
        bucketDate,
        successIncrement,
        failureIncrement,
        Date.now(),
      );
  }

  async getSourceRouteStats(
    sinceDate: string,
  ): Promise<SourceRouteStatsItem[]> {
    const rows = this.db
      .prepare(
        `SELECT
          source,
          route_mode,
          COALESCE(SUM(success_count), 0) AS success_count,
          COALESCE(SUM(failure_count), 0) AS failure_count
        FROM source_route_stats
        WHERE bucket_date >= ?
        GROUP BY source, route_mode`,
      )
      .all(sinceDate) as SourceRouteStatsRow[];

    return rows
      .filter(
        (row) => row.route_mode === 'browser' || row.route_mode === 'server',
      )
      .map((row) => ({
        source: row.source,
        routeMode: row.route_mode as SourceRouteStatsItem['routeMode'],
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }

  async getAllSourceRouteStatBuckets(): Promise<SourceRouteStatsBucket[]> {
    const rows = this.db
      .prepare(
        `SELECT source, route_mode, bucket_date, success_count, failure_count
        FROM source_route_stats
        ORDER BY bucket_date ASC, source ASC, route_mode ASC`,
      )
      .all() as (SourceRouteStatsRow & { bucket_date: string })[];

    return rows
      .filter(
        (row) => row.route_mode === 'browser' || row.route_mode === 'server',
      )
      .map((row) => ({
        source: row.source,
        routeMode: row.route_mode as SourceRouteStatsBucket['routeMode'],
        bucketDate: row.bucket_date,
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }

  async clearAllData(): Promise<void> {
    const clear = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM users;
        DELETE FROM play_records;
        DELETE FROM favorites;
        DELETE FROM search_history;
        DELETE FROM skip_configs;
        DELETE FROM playback_sessions;
        DELETE FROM admin_config;
        DELETE FROM source_route_stats;
        DELETE FROM user_message_state;
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
        DELETE FROM playback_sessions;
        DELETE FROM admin_config;
        DELETE FROM source_route_stats;
        DELETE FROM user_message_state;
      `);

      this.stmts.setAdminConfig.run(JSON.stringify(snapshot.adminConfig));

      const insertRouteStat = this.db.prepare(
        `INSERT INTO source_route_stats (
          source, route_mode, bucket_date, success_count, failure_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const routeStatUpdatedAt = Date.now();
      for (const stat of snapshot.sourceRouteStats) {
        insertRouteStat.run(
          stat.source,
          stat.routeMode,
          stat.bucketDate,
          stat.successCount,
          stat.failureCount,
          routeStatUpdatedAt,
        );
      }

      for (const [userName, passwordHash] of Object.entries(snapshot.users)) {
        const username = assertValidUsernameFormat(userName);
        this.stmts.registerUser.run(username, passwordHash);
      }

      for (const [userName, userData] of Object.entries(snapshot.userData)) {
        const username = assertValidUsernameFormat(userName);
        if (userData.messageState) {
          this.stmts.setUserMessageState.run(
            username,
            JSON.stringify(userData.messageState),
          );
        }
        for (const [key, record] of Object.entries(userData.playRecords)) {
          this.stmts.setPlayRecord.run(username, key, JSON.stringify(record));
        }

        for (const [key, favorite] of Object.entries(userData.favorites)) {
          this.stmts.setFavorite.run(username, key, JSON.stringify(favorite));
        }

        userData.searchHistory
          .slice(0, SEARCH_HISTORY_LIMIT)
          .forEach((keyword, index) => {
            this.stmts.insertSearchHistory.run(username, keyword, index);
          });

        for (const [key, config] of Object.entries(userData.skipConfigs)) {
          this.stmts.setSkipConfig.run(username, key, JSON.stringify(config));
        }

        for (const session of Object.values(userData.playbackSessions)) {
          this.stmts.setPlaybackSession.run(
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
          );
        }
      }
    });

    replace(data);
  }
}
