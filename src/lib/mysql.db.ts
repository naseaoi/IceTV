import 'server-only';

import type {
  ExecuteValues,
  PoolConnection,
  RowDataPacket,
} from 'mysql2/promise';
import mysql from 'mysql2/promise';

import type { InviteCode } from '@/features/admin/services/inviteCodes';
import {
  type AdminUserRow,
  type AdminUserStorageQuery,
  adminUserPage,
  adminUserStatements,
} from '@/features/admin/services/userQueryStorage';
import type { FavoriteLibraryQuery } from '@/features/favorites/lib/library-query';
import {
  type LibraryCountsRow,
  type LibraryRow,
  buildLibraryPage,
  FAVORITE_PROJECTION_COLUMNS,
  favoriteProjection,
  libraryStatements,
} from '@/features/favorites/lib/library-storage';
import {
  type InviteCodeQuery,
  importedInviteCodes,
  INVITE_INSERT_SQL,
  inviteValues,
} from '@/lib/invite-code-storage';
import { MysqlInviteCodeStore } from '@/lib/mysql-invite-code-store';
import { MySqlResourceStore } from '@/lib/mysql-resource-store';
import { MysqlUserAccessStore } from '@/lib/mysql-user-access';
import {
  importedProfileValues,
  ReviewSocialStorage,
  SOCIAL_TABLES,
  socialSchema,
} from '@/lib/review-social-storage';
import {
  canManageUserAccess,
  removedAccessReferences,
  userAccessSchema,
} from '@/lib/user-access';
import { mergeUserMessageState } from '@/lib/user-message-state';
import {
  publicReview,
  reviewPage,
  reviewPageParams,
  reviewSql,
  VideoReviewRow,
} from '@/lib/video-reviews';
import { AdminConfig } from '@/types/admin';

import { hashPassword, verifyPassword } from './password';
import {
  buildPlaybackSearchLikePattern,
  normalizePlaybackSearchKeyword,
} from './playback-query';
import { normalizeRuntimeParam } from './runtime-params';
import { getMySqlConnectionUrl } from './storage-type';
import { buildTrackingSql, MYSQL_TRACKING_DIALECT } from './tracking-sql';
import {
  AdminVideoReviewPage,
  Favorite,
  FavoritePage,
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
  SourceRouteStatInput,
  SourceRouteStatsBucket,
  SourceRouteStatsItem,
  StorageImportData,
  UserMessageState,
  UserMessageStateUpdate,
  VideoReview,
  WorkReviewSummary,
} from './types';
import { assertValidUsernameFormat, normalizeUsername } from './username';

const SEARCH_HISTORY_LIMIT = 20;
const REVIEW_SQL = reviewSql('mysql');
const {
  createdAt: MYSQL_TRACKING_CREATED_AT,
  unreadWhere: MYSQL_UNREAD_TRACKING_WHERE,
} = buildTrackingSql(MYSQL_TRACKING_DIALECT);
const PLAY_RECORD_BATCH_SIZE = 200;

const MYSQL_STALE_PLAY_RECORD_WHERE = `
  CASE
    WHEN JSON_VALID(record_json) = 0 THEN 1
    WHEN JSON_TYPE(JSON_EXTRACT(record_json, '$.metadata_checked_at')) IS NULL THEN 1
    WHEN JSON_TYPE(JSON_EXTRACT(record_json, '$.metadata_checked_at')) NOT IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN 1
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.metadata_checked_at')) AS DECIMAL(30, 6)) <= ? THEN 1
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.metadata_checked_at')) AS DECIMAL(30, 6)) > ? THEN 1
    ELSE 0
  END = 1`;

const MYSQL_STALE_FAVORITE_WHERE = `
  CASE
    WHEN JSON_VALID(favorite_json) = 0 THEN 1
    WHEN JSON_TYPE(JSON_EXTRACT(favorite_json, '$.metadata_checked_at')) IS NULL THEN 1
    WHEN JSON_TYPE(JSON_EXTRACT(favorite_json, '$.metadata_checked_at')) NOT IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN 1
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(favorite_json, '$.metadata_checked_at')) AS DECIMAL(30, 6)) <= ? THEN 1
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(favorite_json, '$.metadata_checked_at')) AS DECIMAL(30, 6)) > ? THEN 1
    ELSE 0
  END = 1`;

const MYSQL_NON_LIVE_FAVORITE_WHERE = `
  CASE
    WHEN JSON_VALID(favorite_json) = 0 THEN 1
    WHEN JSON_UNQUOTE(JSON_EXTRACT(favorite_json, '$.origin')) = 'live' THEN 0
    ELSE 1
  END = 1`;

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

function buildPlayRecordPage(
  rows: JsonRow[],
  total: number,
  limit: number,
): PlayRecordPage {
  const pageRows = rows.slice(0, limit);
  const items: Record<string, PlayRecord> = {};
  for (const row of pageRows) {
    const parsed = parseJsonValue<PlayRecord>(row.record_json);
    if (parsed && row.record_key) items[row.record_key] = parsed;
  }
  const lastRow = pageRows.at(-1);
  const lastRecord = lastRow?.record_key ? items[lastRow.record_key] : null;
  return {
    items,
    total,
    nextCursor:
      rows.length > limit && lastRow?.record_key && lastRecord
        ? `${lastRecord.save_time}|${lastRow.record_key}`
        : null,
  };
}

function buildTrackingPlayRecordPage(
  rows: JsonRow[],
  total: number,
  limit: number,
): PlayRecordPage {
  const pageRows = rows.slice(0, limit);
  const items: Record<string, PlayRecord> = {};
  for (const row of pageRows) {
    const parsed = parseJsonValue<PlayRecord>(row.record_json);
    if (parsed && row.record_key) items[row.record_key] = parsed;
  }
  const lastRow = pageRows.at(-1);
  const lastRecord = lastRow?.record_key ? items[lastRow.record_key] : null;
  const lastCreatedAt = lastRecord
    ? lastRecord.update_detected_at ||
      lastRecord.metadata_checked_at ||
      lastRecord.save_time
    : null;
  return {
    items,
    total,
    nextCursor:
      rows.length > limit && lastRow?.record_key && lastCreatedAt !== null
        ? `${lastCreatedAt}|${lastRow.record_key}`
        : null,
  };
}

function buildFavoritePage(
  rows: JsonRow[],
  total: number,
  limit: number,
): FavoritePage {
  const items = rows.slice(0, limit).flatMap((row) => {
    if (!row.favorite_key || !row.favorite_json) return [];
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

function buildMetadataRecordPage<T>(
  rows: JsonRow[],
  limit: number,
): MetadataRecordPage<T> {
  const pageRows = rows.slice(0, limit);
  const items = pageRows.flatMap((row) => {
    if (!row.record_key || !row.record_json) return [];
    const parsed = parseJsonValue<T>(row.record_json);
    return !parsed
      ? []
      : [{ key: row.record_key, item: parsed, snapshot: row.record_json }];
  });
  const lastRow = pageRows.at(-1);

  return {
    items,
    nextCursor:
      rows.length > limit && lastRow ? (lastRow.record_key ?? '') : null,
  };
}

function buildMetadataFavoritePage(
  rows: JsonRow[],
  limit: number,
): MetadataRecordPage<Favorite> {
  const pageRows = rows.slice(0, limit);
  const items = pageRows.flatMap((row) => {
    if (!row.favorite_key || !row.favorite_json) return [];
    const parsed = parseJsonValue<Favorite>(row.favorite_json);
    return !parsed
      ? []
      : [
          {
            key: row.favorite_key,
            item: parsed,
            snapshot: row.favorite_json,
          },
        ];
  });
  const lastRow = pageRows.at(-1);

  return {
    items,
    nextCursor:
      rows.length > limit && lastRow ? (lastRow.favorite_key ?? '') : null,
  };
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

  const connectionLimit = parseInteger(process.env.MYSQL_CONNECTION_LIMIT, 5);

  return {
    host: parsedUrl.hostname,
    port: parseInteger(parsedUrl.port, 3306),
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: decodeURIComponent(databaseName),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit,
    maxIdle: parseInteger(
      process.env.MYSQL_MAX_IDLE,
      Math.max(1, Math.ceil(connectionLimit / 2)),
    ),
    idleTimeout: parseInteger(process.env.MYSQL_IDLE_TIMEOUT_MS, 60000),
    queueLimit: 0,
    ssl: buildSslOptions(),
  };
}

const IMPORT_BATCH_ROWS = 200;
const MYSQL_MAX_PLACEHOLDERS = 60000;

function createRowBatcher(
  connection: PoolConnection,
  table: string,
  columns: string[],
) {
  const buffer: ExecuteValues[][] = [];
  const columnList = columns.join(', ');
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  const maxRows = Math.max(
    1,
    Math.min(
      IMPORT_BATCH_ROWS,
      Math.floor(MYSQL_MAX_PLACEHOLDERS / columns.length),
    ),
  );

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    const chunk = buffer.splice(0, buffer.length);
    await connection.execute(
      `INSERT INTO ${table} (${columnList}) VALUES ${chunk
        .map(() => rowPlaceholder)
        .join(', ')}`,
      chunk.flat(),
    );
  }

  return {
    async add(row: ExecuteValues[]): Promise<void> {
      buffer.push(row);
      if (buffer.length >= maxRows) await flush();
    },
    flush,
  };
}

async function insertRowsInBatches(
  connection: PoolConnection,
  table: string,
  columns: string[],
  rows: Iterable<ExecuteValues[]>,
): Promise<void> {
  const batcher = createRowBatcher(connection, table, columns);
  for (const row of rows) {
    await batcher.add(row);
  }
  await batcher.flush();
}

type JsonRow = RowDataPacket & {
  record_json?: string;
  favorite_json?: string;
  config_json?: string;
  state_json?: string;
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
  enabled?: number | boolean;
};

export class MySqlStorage implements IStorage {
  // 额度池按 store 实例区分，必须复用同一个实例
  private resourceStore?: MySqlResourceStore;
  get resources() {
    return (this.resourceStore ??= new MySqlResourceStore(this.pool, () =>
      this.ensureInitialized(),
    ));
  }
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
      ...socialSchema('mysql'),
      ...userAccessSchema('mysql'),
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
      `CREATE TABLE IF NOT EXISTS video_reviews (
        username VARCHAR(191) NOT NULL,
        title_norm VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
        year VARCHAR(16) NOT NULL,
        review_json MEDIUMTEXT NOT NULL,
        is_public TINYINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (username, title_norm, year),
        KEY idx_video_reviews_work (title_norm, is_public, updated_at),
        KEY idx_video_reviews_public (is_public, updated_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
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
        KEY idx_playback_sessions_user_video (username, source, video_id),
        KEY idx_playback_sessions_updated_at (updated_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS admin_config (
        id TINYINT NOT NULL PRIMARY KEY,
        config_json LONGTEXT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS user_message_state (
        username VARCHAR(191) NOT NULL PRIMARY KEY,
        state_json LONGTEXT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS user_login_activity (
        username VARCHAR(191) NOT NULL PRIMARY KEY,
        last_login_at BIGINT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS invite_codes (
        code VARCHAR(191) NOT NULL PRIMARY KEY,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_by VARCHAR(191) NOT NULL,
        max_uses INT NULL,
        used_count INT NOT NULL DEFAULT 0,
        KEY idx_invite_codes_created (created_at, code),
        KEY idx_invite_codes_active (expires_at, max_uses, used_count)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
      `CREATE TABLE IF NOT EXISTS invite_code_usage (
        code VARCHAR(191) NOT NULL PRIMARY KEY,
        used_count INT NOT NULL DEFAULT 0
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
      `CREATE TABLE IF NOT EXISTS user_danmaku_episodes (
        username VARCHAR(191) NOT NULL,
        scope_key VARCHAR(255) NOT NULL,
        episode_id INT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (username, scope_key)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS user_danmaku_settings (
        username VARCHAR(191) NOT NULL PRIMARY KEY,
        enabled TINYINT(1) NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS shared_resource_usage (
        resource_key VARCHAR(191) NOT NULL PRIMARY KEY,
        used BIGINT NOT NULL,
        reset_at BIGINT NOT NULL,
        KEY idx_resource_usage_expiry (reset_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
      `CREATE TABLE IF NOT EXISTS shared_resource_leases (
        resource_key VARCHAR(191) NOT NULL,
        token VARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (resource_key, token),
        KEY idx_resource_lease_expiry (expires_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
      `CREATE TABLE IF NOT EXISTS shared_cache (
        cache_key VARCHAR(191) NOT NULL PRIMARY KEY,
        value_text LONGTEXT NOT NULL,
        fresh_until BIGINT NOT NULL,
        stale_until BIGINT NOT NULL,
        lease_token VARCHAR(64) NULL,
        lease_until BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        KEY idx_shared_cache_expiry (stale_until, lease_until),
        KEY idx_shared_cache_updated_at (updated_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
    ];

    for (const statement of statements) {
      await this.pool.execute(statement);
    }

    const [columns] = await this.pool.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM user_profiles LIKE 'avatar_seed'",
    );
    if (columns.length === 0) {
      try {
        await this.pool.execute(
          'ALTER TABLE user_profiles ADD COLUMN avatar_seed VARCHAR(24)',
        );
      } catch (error) {
        // 多实例同时初始化时，其他实例可能已完成加列。
        if ((error as { code?: string }).code !== 'ER_DUP_FIELDNAME')
          throw error;
      }
    }
    await this.migrateFavoriteProjection();
    await this.backfillMissingLoginActivity();
    await this.backfillUserProfiles();
    const accessConnection = await this.pool.getConnection();
    try {
      await accessConnection.beginTransaction();
      await new MysqlUserAccessStore(accessConnection, true).migrate();
      await accessConnection.commit();
    } catch (error) {
      await accessConnection.rollback();
      throw error;
    } finally {
      accessConnection.release();
    }
    await this.invites.migrate();
  }

  private async migrateFavoriteProjection(): Promise<void> {
    const [columns] = await this.pool.query<RowDataPacket[]>(
      'SHOW COLUMNS FROM favorites',
    );
    for (const [name, type] of Object.entries({
      title_norm: 'TEXT COLLATE utf8mb4_bin',
      year_norm: 'TEXT COLLATE utf8mb4_bin',
      year_number: 'DOUBLE',
      search_text: 'LONGTEXT COLLATE utf8mb4_bin',
      saved_at: 'DOUBLE',
      library_valid: 'TINYINT NOT NULL DEFAULT 0',
      projection_version: 'INT NOT NULL DEFAULT 0',
    })) {
      if (columns.some((column) => column.Field === name)) continue;
      try {
        await this.pool.execute(
          `ALTER TABLE favorites ADD COLUMN ${name} ${type}`,
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'ER_DUP_FIELDNAME')
          throw error;
      }
    }
    const [indexes] = await this.pool.query<RowDataPacket[]>(
      'SHOW INDEX FROM favorites',
    );
    for (const [name, columns] of Object.entries({
      idx_favorites_saved: 'username, saved_at, favorite_key',
      idx_favorites_work: 'username, title_norm(191), year_norm(16)',
      idx_favorites_projection: 'projection_version',
    })) {
      if (indexes.some((index) => index.Key_name === name)) continue;
      try {
        await this.pool.execute(
          `CREATE INDEX ${name} ON favorites (${columns})`,
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error;
      }
    }
    for (;;) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        'SELECT username, favorite_key, favorite_json FROM favorites WHERE projection_version = 0 LIMIT 250',
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        // CAS 防止回填覆盖同时发生的收藏更新；另一实例已经完成的行同样跳过。
        await this.pool.execute(
          `UPDATE favorites SET ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE username = ? AND favorite_key = ? AND projection_version = 0 AND BINARY favorite_json = BINARY ?`,
          [
            ...favoriteProjection(row.favorite_key, row.favorite_json),
            row.username,
            row.favorite_key,
            row.favorite_json,
          ],
        );
      }
    }
  }

  private async backfillUserProfiles(
    executor: Pick<PoolConnection, 'query' | 'execute'> = this.pool,
  ): Promise<void> {
    const [rows] = await executor.query<RowDataPacket[]>(
      'SELECT u.username FROM users u LEFT JOIN user_profiles p ON p.username = u.username WHERE p.username IS NULL',
    );
    for (const row of rows)
      await this.socialFor(executor).ensureUserProfile(String(row.username));
  }

  // 每个用户都必须有活跃记录行，缺失的按当前时刻补齐
  private async backfillMissingLoginActivity(
    connection?: PoolConnection,
  ): Promise<void> {
    const executor = connection || this.pool;
    await executor.execute(
      'INSERT IGNORE INTO user_login_activity (username, last_login_at) SELECT username, ? FROM users',
      [Date.now()],
    );
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

  async setPlayRecordIfUnchanged(
    userName: string,
    key: string,
    record: PlayRecord,
    snapshot: string,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [result] = await this.pool.execute(
      `UPDATE play_records
       SET record_json = ?
       WHERE username = ?
         AND record_key = ?
         AND BINARY record_json = BINARY ?`,
      [JSON.stringify(record), username, key, snapshot],
    );
    return Number((result as { affectedRows?: number }).affectedRows || 0) > 0;
  }

  async setPlayRecords(
    userName: string,
    records: Record<string, PlayRecord>,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    const entries = Object.entries(records);
    if (entries.length === 0) return;

    await this.withTransaction(async (connection) => {
      for (
        let offset = 0;
        offset < entries.length;
        offset += PLAY_RECORD_BATCH_SIZE
      ) {
        const chunk = entries.slice(offset, offset + PLAY_RECORD_BATCH_SIZE);
        const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
        const params = chunk.flatMap(([key, record]) => [
          username,
          key,
          JSON.stringify(record),
        ]);
        await connection.execute(
          `INSERT INTO play_records (username, record_key, record_json)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE record_json = VALUES(record_json)`,
          params,
        );
      }
    });
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

  async getStalePlayRecordPage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<PlayRecord>> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const pageLimit = Math.max(1, Math.floor(limit));
    const staleBefore = now - ttlMs;
    const hasCursor = cursorKey !== undefined;
    const [rows] = await this.pool.query<JsonRow[]>(
      hasCursor
        ? `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?
             AND record_key > ?
             AND ${MYSQL_STALE_PLAY_RECORD_WHERE}
           ORDER BY record_key ASC
           LIMIT ?`
        : `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?
             AND ${MYSQL_STALE_PLAY_RECORD_WHERE}
           ORDER BY record_key ASC
           LIMIT ?`,
      hasCursor
        ? [username, cursorKey, staleBefore, now, pageLimit + 1]
        : [username, staleBefore, now, pageLimit + 1],
    );

    return buildMetadataRecordPage<PlayRecord>(rows, pageLimit);
  }

  async getPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const saveTimeExpression =
      "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.save_time')) AS UNSIGNED)";
    const hasCursor = cursorTime !== undefined && !!cursorKey;
    const rowsQuery = this.pool.query<JsonRow[]>(
      hasCursor
        ? `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?
             AND (${saveTimeExpression} < ?
               OR (${saveTimeExpression} = ? AND record_key < ?))
           ORDER BY ${saveTimeExpression} DESC, record_key DESC
           LIMIT ?`
        : `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?
           ORDER BY ${saveTimeExpression} DESC, record_key DESC
           LIMIT ?`,
      hasCursor
        ? [username, cursorTime, cursorTime, cursorKey, limit + 1]
        : [username, limit + 1],
    );
    const countQuery = this.pool.query<
      Array<RowDataPacket & { count: number }>
    >('SELECT COUNT(*) AS count FROM play_records WHERE username = ?', [
      username,
    ]);
    const [[rows], [countRows]] = await Promise.all([rowsQuery, countQuery]);
    return buildPlayRecordPage(rows, countRows[0]?.count || 0, limit);
  }

  async getUnreadTrackingPlayRecordPage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
  ): Promise<PlayRecordPage> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const hasCursor = cursorTime !== undefined && !!cursorKey;
    const rowsQuery = this.pool.query<JsonRow[]>(
      hasCursor
        ? `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?
             AND ${MYSQL_UNREAD_TRACKING_WHERE}
             AND (${MYSQL_TRACKING_CREATED_AT} < ?
               OR (${MYSQL_TRACKING_CREATED_AT} = ? AND record_key < ?))
           ORDER BY ${MYSQL_TRACKING_CREATED_AT} DESC, record_key DESC
           LIMIT ?`
        : `SELECT record_key, record_json
           FROM play_records
           WHERE username = ? AND ${MYSQL_UNREAD_TRACKING_WHERE}
           ORDER BY ${MYSQL_TRACKING_CREATED_AT} DESC, record_key DESC
           LIMIT ?`,
      hasCursor
        ? [username, cursorTime, cursorTime, cursorKey, limit + 1]
        : [username, limit + 1],
    );
    const countQuery = this.pool.query<
      Array<RowDataPacket & { count: number }>
    >(
      `SELECT COUNT(*) AS count
       FROM play_records
       WHERE username = ? AND ${MYSQL_UNREAD_TRACKING_WHERE}`,
      [username],
    );
    const [[rows], [countRows]] = await Promise.all([rowsQuery, countQuery]);
    return buildTrackingPlayRecordPage(rows, countRows[0]?.count || 0, limit);
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
      `INSERT INTO favorites (username, favorite_key, favorite_json, ${FAVORITE_PROJECTION_COLUMNS.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE favorite_json = VALUES(favorite_json), ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = VALUES(${column})`).join(', ')}`,
      [
        username,
        key,
        JSON.stringify(favorite),
        ...favoriteProjection(key, JSON.stringify(favorite)),
      ],
    );
  }

  async setFavoriteIfUnchanged(
    userName: string,
    key: string,
    favorite: Favorite,
    snapshot: string,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [result] = await this.pool.execute(
      `UPDATE favorites
       SET favorite_json = ?, ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = ?`).join(', ')}
       WHERE username = ?
         AND favorite_key = ?
         AND BINARY favorite_json = BINARY ?`,
      [
        JSON.stringify(favorite),
        ...favoriteProjection(key, JSON.stringify(favorite)),
        username,
        key,
        snapshot,
      ],
    );
    return Number((result as { affectedRows?: number }).affectedRows || 0) > 0;
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

  async getStaleFavoritePage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<Favorite>> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const pageLimit = Math.max(1, Math.floor(limit));
    const staleBefore = now - ttlMs;
    const hasCursor = cursorKey !== undefined;
    const [rows] = await this.pool.query<JsonRow[]>(
      hasCursor
        ? `SELECT favorite_key, favorite_json
           FROM favorites
           WHERE username = ?
             AND favorite_key > ?
             AND ${MYSQL_STALE_FAVORITE_WHERE}
             AND ${MYSQL_NON_LIVE_FAVORITE_WHERE}
           ORDER BY favorite_key ASC
           LIMIT ?`
        : `SELECT favorite_key, favorite_json
           FROM favorites
           WHERE username = ?
             AND ${MYSQL_STALE_FAVORITE_WHERE}
             AND ${MYSQL_NON_LIVE_FAVORITE_WHERE}
           ORDER BY favorite_key ASC
           LIMIT ?`,
      hasCursor
        ? [username, cursorKey, staleBefore, now, pageLimit + 1]
        : [username, staleBefore, now, pageLimit + 1],
    );

    return buildMetadataFavoritePage(rows, pageLimit);
  }

  async getFavoritePage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
    includeLive = true,
  ): Promise<FavoritePage> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const saveTimeExpression =
      "CAST(JSON_UNQUOTE(JSON_EXTRACT(f.favorite_json, '$.save_time')) AS UNSIGNED)";
    const hasCursor = cursorTime !== undefined && !!cursorKey;
    const rowsQuery = this.pool.query<JsonRow[]>(
      hasCursor
        ? `SELECT f.favorite_key, f.favorite_json, p.record_json
           FROM favorites f
           LEFT JOIN play_records p
             ON p.username = f.username AND p.record_key = f.favorite_key
           WHERE f.username = ?
             AND (? = 1 OR ${MYSQL_NON_LIVE_FAVORITE_WHERE})
             AND (${saveTimeExpression} < ?
               OR (${saveTimeExpression} = ? AND f.favorite_key < ?))
           ORDER BY ${saveTimeExpression} DESC, f.favorite_key DESC
           LIMIT ?`
        : `SELECT f.favorite_key, f.favorite_json, p.record_json
           FROM favorites f
           LEFT JOIN play_records p
             ON p.username = f.username AND p.record_key = f.favorite_key
           WHERE f.username = ?
             AND (? = 1 OR ${MYSQL_NON_LIVE_FAVORITE_WHERE})
           ORDER BY ${saveTimeExpression} DESC, f.favorite_key DESC
           LIMIT ?`,
      hasCursor
        ? [
            username,
            Number(includeLive),
            cursorTime,
            cursorTime,
            cursorKey,
            limit + 1,
          ]
        : [username, Number(includeLive), limit + 1],
    );
    const countQuery = this.pool.query<
      Array<RowDataPacket & { count: number }>
    >(
      `SELECT COUNT(*) AS count FROM favorites
       WHERE username = ? AND (? = 1 OR ${MYSQL_NON_LIVE_FAVORITE_WHERE})`,
      [username, Number(includeLive)],
    );
    const [[rows], [countRows]] = await Promise.all([rowsQuery, countQuery]);
    return buildFavoritePage(rows, countRows[0]?.count || 0, limit);
  }

  async getFavoriteLibraryPage(userName: string, query: FavoriteLibraryQuery) {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const sql = libraryStatements('mysql', username, query);
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      const [counts] = await connection.query<
        (LibraryCountsRow & RowDataPacket)[]
      >(sql.counts, sql.countParams);
      const [rows] = await connection.query<(LibraryRow & RowDataPacket)[]>(
        sql.page,
        sql.pageParams,
      );
      await connection.commit();
      return buildLibraryPage(username, query, rows, counts[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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

  private socialFor(
    executor: Pick<PoolConnection, 'query' | 'execute'> = this.pool,
  ) {
    return new ReviewSocialStorage({
      dialect: 'mysql',
      rows: async <T>(sql: string, params: unknown[] = []) =>
        (await executor.query(sql, params as ExecuteValues))[0] as T[],
      run: async (sql, params = []) =>
        (
          (
            await executor.execute(sql, params as ExecuteValues)
          )[0] as import('mysql2/promise').ResultSetHeader
        ).affectedRows,
    });
  }

  async getUserProfile(
    ...args: Parameters<IStorage['getUserProfile']>
  ): ReturnType<IStorage['getUserProfile']> {
    await this.ensureInitialized();
    return this.socialFor().getUserProfile(...args);
  }

  async getUserProfileById(
    ...args: Parameters<IStorage['getUserProfileById']>
  ): ReturnType<IStorage['getUserProfileById']> {
    await this.ensureInitialized();
    return this.socialFor().getUserProfileById(...args);
  }

  async ensureUserProfile(
    ...args: Parameters<IStorage['ensureUserProfile']>
  ): ReturnType<IStorage['ensureUserProfile']> {
    await this.ensureInitialized();
    return this.socialFor().ensureUserProfile(...args);
  }

  async updateUserProfile(
    ...args: Parameters<IStorage['updateUserProfile']>
  ): ReturnType<IStorage['updateUserProfile']> {
    await this.ensureInitialized();
    return this.socialFor().updateUserProfile(...args);
  }

  async isNicknameAvailable(
    ...args: Parameters<IStorage['isNicknameAvailable']>
  ): ReturnType<IStorage['isNicknameAvailable']> {
    await this.ensureInitialized();
    return this.socialFor().isNicknameAvailable(...args);
  }

  async getUserProfileView(
    ...args: Parameters<IStorage['getUserProfileView']>
  ): ReturnType<IStorage['getUserProfileView']> {
    await this.ensureInitialized();
    return this.socialFor().getUserProfileView(...args);
  }

  async setUserFollow(
    ...args: Parameters<IStorage['setUserFollow']>
  ): ReturnType<IStorage['setUserFollow']> {
    await this.ensureInitialized();
    return this.socialFor().setUserFollow(...args);
  }

  async getUserFollowPage(
    ...args: Parameters<IStorage['getUserFollowPage']>
  ): ReturnType<IStorage['getUserFollowPage']> {
    await this.ensureInitialized();
    return this.socialFor().getUserFollowPage(...args);
  }

  async getUserPublicReviewPage(
    ...args: Parameters<IStorage['getUserPublicReviewPage']>
  ): ReturnType<IStorage['getUserPublicReviewPage']> {
    await this.ensureInitialized();
    return this.socialFor().getUserPublicReviewPage(...args);
  }

  async setVideoReviewLike(
    ...args: Parameters<IStorage['setVideoReviewLike']>
  ): ReturnType<IStorage['setVideoReviewLike']> {
    await this.ensureInitialized();
    return this.withTransaction(async (connection) => {
      await connection.query(
        'SELECT username FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1 FOR UPDATE',
        [normalizeUsername(args[0]), args[1], args[2]],
      );
      return this.socialFor(connection).setVideoReviewLike(...args);
    });
  }

  async reportVideoReview(
    ...args: Parameters<IStorage['reportVideoReview']>
  ): ReturnType<IStorage['reportVideoReview']> {
    await this.ensureInitialized();
    return this.withTransaction(async (connection) => {
      await connection.query(
        'SELECT username FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1 FOR UPDATE',
        [normalizeUsername(args[0]), args[1], args[2]],
      );
      return this.socialFor(connection).reportVideoReview(...args);
    });
  }

  async getReviewReportPage(
    ...args: Parameters<IStorage['getReviewReportPage']>
  ): ReturnType<IStorage['getReviewReportPage']> {
    await this.ensureInitialized();
    return this.withTransaction((connection) =>
      this.socialFor(connection).getReviewReportPage(...args),
    );
  }

  async getFollowReviewMessageCount(
    ...args: Parameters<IStorage['getFollowReviewMessageCount']>
  ): Promise<number> {
    await this.ensureInitialized();
    return this.socialFor().getFollowReviewMessageCount(...args);
  }

  async getFollowReviewMessages(
    ...args: Parameters<IStorage['getFollowReviewMessages']>
  ): ReturnType<IStorage['getFollowReviewMessages']> {
    await this.ensureInitialized();
    return this.socialFor().getFollowReviewMessages(...args);
  }

  async getUserSocialData(
    ...args: Parameters<IStorage['getUserSocialData']>
  ): ReturnType<IStorage['getUserSocialData']> {
    await this.ensureInitialized();
    return this.socialFor().getUserSocialData(...args);
  }

  async getVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
  ): Promise<VideoReview | null> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<(VideoReviewRow & RowDataPacket)[]>(
      year ? REVIEW_SQL.own : REVIEW_SQL.latest,
      year ? [username, titleNorm, year, year, year] : [username, titleNorm],
    );
    return parseJsonValue<VideoReview>(rows[0]?.review_json);
  }

  async setVideoReview(userName: string, review: VideoReview): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      `INSERT INTO video_reviews
      (username, title_norm, year, review_json, is_public, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE review_json = JSON_SET(VALUES(review_json), '$.created_at', JSON_EXTRACT(review_json, '$.created_at')),
      is_public = VALUES(is_public), updated_at = VALUES(updated_at)`,
      [
        normalizeUsername(userName),
        review.title_norm,
        review.year,
        JSON.stringify(review),
        review.is_public ? 1 : 0,
        review.updated_at,
      ],
    );
  }

  async deleteVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
    publicOnly = false,
  ): Promise<void> {
    await this.withTransaction(async (connection) => {
      const target = [normalizeUsername(userName), titleNorm, year];
      const [result] = await connection.execute<
        import('mysql2/promise').ResultSetHeader
      >(REVIEW_SQL.delete, [...target, publicOnly ? 1 : 0]);
      if (result.affectedRows)
        for (const table of ['video_review_likes', 'video_review_reports'])
          await connection.execute(
            `DELETE FROM ${table} WHERE author = ? AND title_norm = ? AND year = ?`,
            target,
          );
    });
  }

  async moderateReviewReports(
    author: string,
    title: string,
    year: string,
    action: 'dismiss' | 'mark-spoiler' | 'delete-review',
  ): Promise<void> {
    await this.withTransaction(async (connection) => {
      const target = [normalizeUsername(author), title, year];
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT username FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1 FOR UPDATE',
        target,
      );
      if (!rows.length) return;
      if (action === 'delete-review') {
        await connection.execute(REVIEW_SQL.delete, [...target, 1]);
        await connection.execute(
          'DELETE FROM video_review_likes WHERE author = ? AND title_norm = ? AND year = ?',
          target,
        );
      } else if (action === 'mark-spoiler')
        await connection.execute(
          "UPDATE video_reviews SET review_json = JSON_SET(review_json, '$.spoiler', CAST('true' AS JSON)) WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1",
          target,
        );
      await connection.execute(
        'DELETE FROM video_review_reports WHERE author = ? AND title_norm = ? AND year = ?',
        target,
      );
    });
  }

  async getMyVideoReviewPage(
    ...args: Parameters<IStorage['getMyVideoReviewPage']>
  ): ReturnType<IStorage['getMyVideoReviewPage']> {
    await this.ensureInitialized();
    return this.socialFor().getMyVideoReviewPage(...args);
  }
  async getMyVideoReviewCount(
    ...args: Parameters<IStorage['getMyVideoReviewCount']>
  ): ReturnType<IStorage['getMyVideoReviewCount']> {
    await this.ensureInitialized();
    return this.socialFor().getMyVideoReviewCount(...args);
  }
  async getMyVideoReviewRatings(
    ...args: Parameters<IStorage['getMyVideoReviewRatings']>
  ): ReturnType<IStorage['getMyVideoReviewRatings']> {
    await this.ensureInitialized();
    return this.socialFor().getMyVideoReviewRatings(...args);
  }
  async getWorkVideoReviewPage(
    ...args: Parameters<IStorage['getWorkVideoReviewPage']>
  ): ReturnType<IStorage['getWorkVideoReviewPage']> {
    return this.withTransaction((connection) =>
      this.socialFor(connection).getWorkVideoReviewPage(...args),
    );
  }

  async getAllVideoReviews(userName: string): Promise<VideoReview[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<(VideoReviewRow & RowDataPacket)[]>(
      REVIEW_SQL.all,
      [normalizeUsername(userName)],
    );
    return rows.map((row) => JSON.parse(row.review_json) as VideoReview);
  }

  async getPublicVideoReviewsForWork(
    titleNorm: string,
    year: string,
    viewer = '',
  ): Promise<WorkReviewSummary> {
    return this.withTransaction(async (connection) => {
      const [summaries] = await connection.query<
        (RowDataPacket & { average: string | number | null; count: number })[]
      >(REVIEW_SQL.summary, [titleNorm, year, year]);
      const [rows] = await connection.query<(VideoReviewRow & RowDataPacket)[]>(
        REVIEW_SQL.work,
        [titleNorm, year, year],
      );
      return {
        average:
          summaries[0].average === null ? null : Number(summaries[0].average),
        count: Number(summaries[0].count),
        reviews: (
          await this.socialFor(connection).enrichReviews(rows, viewer)
        ).map(publicReview),
        distribution: await (async () => {
          const [buckets] = await connection.query<RowDataPacket[]>(
            REVIEW_SQL.distribution,
            [titleNorm, year, year],
          );
          const distribution = Array<number>(10).fill(0);
          for (const row of buckets)
            distribution[Math.min(9, Math.max(0, Number(row.bucket) - 1))] +=
              Number(row.count);
          return distribution;
        })(),
      };
    });
  }

  async getPublicVideoReviewPage(
    cursor?: string,
    q?: string,
  ): Promise<AdminVideoReviewPage> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<(VideoReviewRow & RowDataPacket)[]>(
      REVIEW_SQL.page,
      reviewPageParams(cursor, q),
    );
    return reviewPage(await this.socialFor().enrichReviews(rows));
  }

  async registerUser(
    userName: string,
    password: string,
    nickname?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = assertValidUsernameFormat(userName);
    const hashed = await hashPassword(password);
    await this.withTransaction(async (connection) => {
      await connection.execute(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashed],
      );
      await connection.execute(
        'INSERT INTO user_login_activity (username, last_login_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)',
        [username, Date.now()],
      );
      await this.socialFor(connection).ensureUserProfile(username);
      await new MysqlUserAccessStore(connection, true).put({
        username,
        role: 'user',
      });
      if (nickname !== undefined)
        await this.socialFor(connection).updateUserProfile(username, {
          nickname,
        });
    });
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

  async deleteUser(
    userName: string,
    permissions?: Parameters<IStorage['deleteUser']>[1],
  ): Promise<void> {
    if (!(await this.deleteManagedUser(userName, undefined, permissions)))
      throw new Error('用户权限已变化，请刷新后重试');
  }

  async getUserAccess(username: string) {
    await this.ensureInitialized();
    return new MysqlUserAccessStore(this.pool).get(username);
  }

  async getAllUserAccess() {
    await this.ensureInitialized();
    return new MysqlUserAccessStore(this.pool).all();
  }

  async updateUserAccess(...args: Parameters<IStorage['updateUserAccess']>) {
    return this.withTransaction((connection) =>
      new MysqlUserAccessStore(connection, true).update(...args),
    );
  }

  async removeUserGroup(group: string) {
    return this.withTransaction((connection) =>
      new MysqlUserAccessStore(connection, true).removeGroup(group),
    );
  }

  async removeUserSource(source: string) {
    return this.withTransaction((connection) =>
      new MysqlUserAccessStore(connection, true).removeSource(source),
    );
  }

  async deleteUserIfInactive(
    userName: string,
    before: number,
    operatorUsername: string,
  ): Promise<boolean> {
    return this.deleteManagedUser(userName, { before, operatorUsername });
  }

  private async deleteManagedUser(
    userName: string,
    guard?: { before: number; operatorUsername: string },
    permissions?: Parameters<IStorage['deleteUser']>[1],
  ): Promise<boolean> {
    const username = normalizeUsername(userName);
    return this.withTransaction(async (connection) => {
      if (permissions) {
        const access = await new MysqlUserAccessStore(connection, true).get(
          username,
        );
        if (
          !access ||
          !canManageUserAccess(access, { ...permissions, excludeSelf: true })
        )
          return false;
      }
      if (guard) {
        const access = await new MysqlUserAccessStore(connection, true).get(
          username,
        );
        const [activity] = await connection.query<RowDataPacket[]>(
          'SELECT last_login_at FROM user_login_activity WHERE username = ? FOR UPDATE',
          [username],
        );
        const [users] = await connection.query<RowDataPacket[]>(
          'SELECT username FROM users WHERE username = ? FOR UPDATE',
          [username],
        );
        if (
          access?.role !== 'user' ||
          username === normalizeUsername(guard.operatorUsername) ||
          !activity[0]?.last_login_at ||
          Number(activity[0].last_login_at) > guard.before ||
          !users.length
        )
          return false;
      }
      await connection.execute('DELETE FROM user_profiles WHERE username = ?', [
        username,
      ]);
      await connection.execute(
        'DELETE FROM user_follows WHERE follower = ? OR followee = ?',
        [username, username],
      );
      await connection.execute(
        'DELETE FROM video_review_likes WHERE author = ? OR liker = ?',
        [username, username],
      );
      await connection.execute(
        'DELETE FROM video_review_reports WHERE author = ? OR reporter = ?',
        [username, username],
      );
      await connection.execute(
        'DELETE FROM user_group_members WHERE username = ?',
        [username],
      );
      await connection.execute('DELETE FROM user_access WHERE username = ?', [
        username,
      ]);
      await connection.execute('DELETE FROM users WHERE username = ?', [
        username,
      ]);
      await connection.execute('DELETE FROM play_records WHERE username = ?', [
        username,
      ]);
      await connection.execute('DELETE FROM favorites WHERE username = ?', [
        username,
      ]);
      await connection.execute('DELETE FROM video_reviews WHERE username = ?', [
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
      await connection.execute(
        'DELETE FROM user_message_state WHERE username = ?',
        [username],
      );
      await connection.execute(
        'DELETE FROM user_login_activity WHERE username = ?',
        [username],
      );
      await connection.execute(
        'DELETE FROM user_danmaku_episodes WHERE username = ?',
        [username],
      );
      await connection.execute(
        'DELETE FROM user_danmaku_settings WHERE username = ?',
        [username],
      );
      return true;
    });
  }

  async recordUserLogin(userName: string, loginAt: number): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      `INSERT INTO user_login_activity (username, last_login_at)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)`,
      [username, loginAt],
    );
  }

  async getUserLastLogin(userName: string): Promise<number | null> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT last_login_at FROM user_login_activity WHERE username = ? LIMIT 1',
      [username],
    );
    const value = rows[0]?.last_login_at;
    return value === undefined || value === null ? null : Number(value);
  }

  async getAllUserLastLogins(): Promise<Record<string, number>> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT username, last_login_at FROM user_login_activity',
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      if (typeof row.username === 'string') {
        result[row.username] = Number(row.last_login_at || 0);
      }
    }
    return result;
  }

  private get invites() {
    return new MysqlInviteCodeStore(this.pool);
  }

  async getAllInviteCodes() {
    await this.ensureInitialized();
    return this.invites.all();
  }
  async queryInviteCodes(query: InviteCodeQuery) {
    await this.ensureInitialized();
    return this.invites.page(query);
  }
  async countActiveInviteCodes() {
    await this.ensureInitialized();
    return this.invites.countActive();
  }
  async createInviteCode(item: InviteCode) {
    await this.ensureInitialized();
    return this.invites.create(item);
  }
  async deleteInviteCode(code: string) {
    await this.ensureInitialized();
    return this.invites.delete(code);
  }
  async reserveInviteCodeUse(code: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.invites.reserve(code);
  }
  async releaseInviteCodeUse(code: string): Promise<void> {
    await this.ensureInitialized();
    await this.invites.release(code);
  }

  async getAllInviteCodeUsage(): Promise<Record<string, number>> {
    return Object.fromEntries(
      (await this.getAllInviteCodes()).map((item) => [
        item.code,
        item.usedCount || 0,
      ]),
    );
  }

  async deleteInviteCodeUsage(code: string): Promise<void> {
    await this.deleteInviteCode(code);
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

  async getAdminUserPage(query: AdminUserStorageQuery) {
    const sql = adminUserStatements('mysql', query);
    return this.withTransaction(async (connection) => {
      const [counts] = await connection.query<RowDataPacket[]>(
        sql.count,
        sql.countParams,
      );
      const [rows] = await connection.query<(RowDataPacket & AdminUserRow)[]>(
        sql.rows,
        sql.params,
      );
      return adminUserPage(rows, Number(counts[0].total), sql.scope, sql.limit);
    });
  }

  async compareAndSetAdminConfig(
    expected: AdminConfig | null,
    config: AdminConfig,
  ): Promise<boolean> {
    return this.withTransaction(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
      );
      const current = rows[0]
        ? parseJsonValue<AdminConfig>(rows[0].config_json)
        : null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      const removed = removedAccessReferences(current, config);
      const access = new MysqlUserAccessStore(connection, true);
      for (const group of removed.groups) await access.removeGroup(group);
      for (const source of removed.sources) await access.removeSource(source);
      await connection.execute(
        'INSERT INTO admin_config (id, config_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)',
        [JSON.stringify(config)],
      );
      return true;
    });
  }

  async getAllUsers(): Promise<string[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT username FROM users ORDER BY username ASC',
    );
    const usernames = rows
      .map((row) => row.username)
      .filter(Boolean)
      .map((username) => normalizeUsername(username as string));
    return [...new Set(usernames)];
  }

  async getAllUsersWithPasswords(): Promise<{ [username: string]: string }> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT username, password FROM users ORDER BY username ASC',
    );
    const result: { [username: string]: string } = {};
    for (const row of rows) {
      if (row.username && row.password) {
        result[normalizeUsername(row.username as string)] = row.password;
      }
    }
    return result;
  }

  async getUserMessageState(userName: string): Promise<UserMessageState> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT state_json FROM user_message_state WHERE username = ? LIMIT 1',
      [username],
    );
    return parseJsonValue<UserMessageState>(rows[0]?.state_json) || {};
  }

  async updateUserMessageState(
    userName: string,
    update: UserMessageStateUpdate,
  ): Promise<UserMessageState> {
    const username = normalizeUsername(userName);
    return this.withTransaction(async (connection) => {
      // 先建占位行，使首次并发已读也能锁住同一主键。
      await connection.execute(
        'INSERT INTO user_message_state (username, state_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)',
        [username, '{}'],
      );
      const [rows] = await connection.query<JsonRow[]>(
        'SELECT state_json FROM user_message_state WHERE username = ? FOR UPDATE',
        [username],
      );
      const next = mergeUserMessageState(
        parseJsonValue<UserMessageState>(rows[0]?.state_json) || {},
        update,
      );
      await connection.execute(
        'UPDATE user_message_state SET state_json = ? WHERE username = ?',
        [JSON.stringify(next), username],
      );
      return next;
    });
  }

  async setUserMessageState(
    userName: string,
    state: UserMessageState,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      `INSERT INTO user_message_state (username, state_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)`,
      [username, JSON.stringify(state)],
    );
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

  async getDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<number | null> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT episode_id FROM user_danmaku_episodes WHERE username = ? AND scope_key = ?',
      [username, scopeKey],
    );
    return rows.length > 0 ? (rows[0].episode_id as number) : null;
  }

  async setDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
    episodeId: number,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      'INSERT INTO user_danmaku_episodes (username, scope_key, episode_id, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE episode_id = VALUES(episode_id), updated_at = VALUES(updated_at)',
      [username, scopeKey, episodeId, Date.now()],
    );
  }

  async deleteDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      'DELETE FROM user_danmaku_episodes WHERE username = ? AND scope_key = ?',
      [username, scopeKey],
    );
  }

  async getDanmakuEnabledPreference(userName: string): Promise<boolean | null> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const [rows] = await this.pool.query<JsonRow[]>(
      'SELECT enabled FROM user_danmaku_settings WHERE username = ? LIMIT 1',
      [username],
    );
    return rows.length > 0 ? Number(rows[0].enabled) !== 0 : null;
  }

  async setDanmakuEnabledPreference(
    userName: string,
    enabled: boolean,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.pool.execute(
      `INSERT INTO user_danmaku_settings (username, enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [username, enabled ? 1 : 0],
    );
  }

  async getSharedCache(key: string): Promise<SharedCacheRecord | null> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT value_text, fresh_until, stale_until, lease_until
       FROM shared_cache WHERE cache_key = ? LIMIT 1`,
      [key],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      value: String(row.value_text || ''),
      freshUntil: Number(row.fresh_until),
      staleUntil: Number(row.stale_until),
      leaseUntil: Number(row.lease_until),
    };
  }

  async acquireSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const [updated] = await this.pool.execute(
      `UPDATE shared_cache
       SET lease_token = ?, lease_until = ?, updated_at = ?
       WHERE cache_key = ? AND lease_until <= ?`,
      [token, leaseUntil, now, key, now],
    );
    if ('affectedRows' in updated && updated.affectedRows > 0) {
      return true;
    }

    const [inserted] = await this.pool.execute(
      `INSERT IGNORE INTO shared_cache (
         cache_key, value_text, fresh_until, stale_until,
         lease_token, lease_until, updated_at
       ) VALUES (?, '', 0, 0, ?, ?, ?)`,
      [key, token, leaseUntil, now],
    );
    return 'affectedRows' in inserted && inserted.affectedRows > 0;
  }

  async setSharedCache(
    key: string,
    token: string,
    value: string,
    freshUntil: number,
    staleUntil: number,
    now: number,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const [result] = await this.pool.execute(
      `UPDATE shared_cache
       SET value_text = ?, fresh_until = ?, stale_until = ?,
           lease_token = NULL, lease_until = 0, updated_at = ?
       WHERE cache_key = ? AND lease_token = ?`,
      [value, freshUntil, staleUntil, now, key, token],
    );
    return 'affectedRows' in result && result.affectedRows > 0;
  }

  async releaseSharedCacheLease(key: string, token: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      `UPDATE shared_cache
       SET lease_token = NULL, lease_until = 0
       WHERE cache_key = ? AND lease_token = ?`,
      [key, token],
    );
  }

  async renewSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const [result] = await this.pool.execute(
      'UPDATE shared_cache SET lease_until = ? WHERE cache_key = ? AND lease_token = ? AND lease_until > ?',
      [leaseUntil, key, token, now],
    );
    return 'affectedRows' in result && result.affectedRows > 0;
  }

  async pruneSharedCache(now: number, limit: number): Promise<void> {
    await this.ensureInitialized();
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    await this.pool.query(
      `DELETE FROM shared_cache
       WHERE stale_until <= ? AND lease_until <= ?
       ORDER BY updated_at ASC LIMIT ${safeLimit}`,
      [now, now],
    );
    await this.pool.query(
      `DELETE FROM shared_cache WHERE cache_key IN (
      SELECT cache_key FROM (
        SELECT cache_key,
          ROW_NUMBER() OVER (ORDER BY updated_at DESC, cache_key DESC) AS entry_rank,
          SUM(OCTET_LENGTH(value_text)) OVER (ORDER BY updated_at DESC, cache_key DESC) AS cache_bytes
        FROM shared_cache WHERE lease_until <= ?
      ) AS budget WHERE entry_rank > 4096 OR cache_bytes > 134217728
    )`,
      [now],
    );
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

  async deletePlaybackSessionsBefore(updatedBefore: number): Promise<number> {
    await this.ensureInitialized();
    const cutoff = Number.isFinite(updatedBefore)
      ? Math.max(0, Math.floor(updatedBefore))
      : 0;
    const [result] = await this.pool.execute(
      'DELETE FROM playback_sessions WHERE updated_at < ?',
      [cutoff],
    );
    return Number((result as { affectedRows?: number }).affectedRows || 0);
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

  async getPlaybackPeriodSessions(
    userName: string,
    start: number,
    end: number,
  ): Promise<PlaybackPeriodSession[]> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [];
    const [rows] = await this.pool.query<JsonRow[]>(
      `SELECT source, video_id, title, cover, year, started_at, ended_at, watch_seconds
        FROM playback_sessions
        WHERE username = ? AND started_at >= ? AND started_at < ? AND watch_seconds > 0`,
      [username, start, end],
    );
    return rows.map((row) => ({
      source: row.source || '',
      video_id: row.video_id || '',
      title: row.title || '',
      cover: row.cover || '',
      year: row.year || '',
      started_at: Number(row.started_at),
      ended_at: Number(row.ended_at),
      watch_seconds: Number(row.watch_seconds),
    }));
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
      await connection.execute('DELETE FROM user_group_members');
      await connection.execute('DELETE FROM user_access');
      await connection.execute('DELETE FROM users');
      await connection.execute('DELETE FROM play_records');
      await connection.execute('DELETE FROM favorites');
      await connection.execute('DELETE FROM video_reviews');
      for (const table of SOCIAL_TABLES)
        await connection.execute(`DELETE FROM ${table}`);
      await connection.execute('DELETE FROM search_history');
      await connection.execute('DELETE FROM skip_configs');
      await connection.execute('DELETE FROM playback_sessions');
      await connection.execute('DELETE FROM admin_config');
      await connection.execute('DELETE FROM source_route_stats');
      await connection.execute('DELETE FROM user_message_state');
      await connection.execute('DELETE FROM user_login_activity');
      await connection.execute('DELETE FROM invite_code_usage');
      await connection.execute('DELETE FROM invite_codes');
      await connection.execute('DELETE FROM user_danmaku_episodes');
      await connection.execute('DELETE FROM user_danmaku_settings');
      await connection.execute('DELETE FROM shared_cache');
    });
  }

  private async importSocialData(
    connection: PoolConnection,
    snapshot: StorageImportData,
  ): Promise<void> {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [username, data] of Object.entries(snapshot.userData)) {
      await connection.execute(
        'INSERT INTO user_profiles (username, profile_id, nickname, nickname_norm, avatar_seed, favorites_public, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        importedProfileValues(
          username,
          data.profile,
          ids,
          names,
        ) as ExecuteValues,
      );
      for (const row of data.follows ?? [])
        await connection.execute(
          'INSERT IGNORE INTO user_follows (follower, followee, created_at) VALUES (?, ?, ?)',
          [
            normalizeUsername(username),
            normalizeUsername(row.followee),
            row.created_at,
          ],
        );
      for (const row of data.likes ?? [])
        await connection.execute(
          'INSERT IGNORE INTO video_review_likes (author, title_norm, year, liker, created_at) VALUES (?, ?, ?, ?, ?)',
          [
            normalizeUsername(row.author),
            row.title_norm,
            row.year,
            normalizeUsername(username),
            row.created_at,
          ],
        );
      for (const row of data.reports ?? [])
        await connection.execute(
          'INSERT INTO video_review_reports (author, title_norm, year, reporter, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason), detail = VALUES(detail), created_at = VALUES(created_at)',
          [
            normalizeUsername(row.author),
            row.title_norm,
            row.year,
            normalizeUsername(username),
            row.reason,
            row.detail,
            row.created_at,
          ],
        );
    }
  }

  async replaceAllData(data: StorageImportData): Promise<void> {
    const searchHistoryLimit = normalizeRuntimeParam(
      'SearchHistoryLimit',
      data.adminConfig?.SiteConfig?.SearchHistoryLimit,
    );
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM user_group_members');
      await connection.execute('DELETE FROM user_access');
      await connection.execute('DELETE FROM users');
      await connection.execute('DELETE FROM play_records');
      await connection.execute('DELETE FROM favorites');
      await connection.execute('DELETE FROM video_reviews');
      for (const table of SOCIAL_TABLES)
        await connection.execute(`DELETE FROM ${table}`);
      await connection.execute('DELETE FROM search_history');
      await connection.execute('DELETE FROM skip_configs');
      await connection.execute('DELETE FROM playback_sessions');
      await connection.execute('DELETE FROM admin_config');
      await connection.execute('DELETE FROM source_route_stats');
      await connection.execute('DELETE FROM user_message_state');
      await connection.execute('DELETE FROM user_login_activity');
      await connection.execute('DELETE FROM invite_code_usage');
      await connection.execute('DELETE FROM invite_codes');
      await connection.execute('DELETE FROM user_danmaku_episodes');
      await connection.execute('DELETE FROM user_danmaku_settings');
      await connection.execute('DELETE FROM shared_cache');

      const inviteCodes = importedInviteCodes(
        data.adminConfig.UserConfig?.InviteCodes,
        data.inviteCodeUsage,
      );
      const storedConfig = JSON.parse(
        JSON.stringify(data.adminConfig),
      ) as AdminConfig;
      if (storedConfig.UserConfig) delete storedConfig.UserConfig.InviteCodes;
      await connection.execute(
        'INSERT INTO admin_config (id, config_json) VALUES (1, ?)',
        [JSON.stringify(storedConfig)],
      );
      for (const item of inviteCodes)
        await connection.execute(INVITE_INSERT_SQL, inviteValues(item));

      const routeStatUpdatedAt = Date.now();
      await insertRowsInBatches(
        connection,
        'source_route_stats',
        [
          'source',
          'route_mode',
          'bucket_date',
          'success_count',
          'failure_count',
          'updated_at',
        ],
        data.sourceRouteStats.map((stat) => [
          stat.source,
          stat.routeMode,
          stat.bucketDate,
          stat.successCount,
          stat.failureCount,
          routeStatUpdatedAt,
        ]),
      );

      await insertRowsInBatches(
        connection,
        'users',
        ['username', 'password'],
        Object.entries(data.users).map(([userName, passwordHash]) => [
          assertValidUsernameFormat(userName),
          passwordHash,
        ]),
      );

      const messageStates = createRowBatcher(connection, 'user_message_state', [
        'username',
        'state_json',
      ]);
      const danmakuSettings = createRowBatcher(
        connection,
        'user_danmaku_settings',
        ['username', 'enabled'],
      );
      const loginActivities = createRowBatcher(
        connection,
        'user_login_activity',
        ['username', 'last_login_at'],
      );
      const playRecords = createRowBatcher(connection, 'play_records', [
        'username',
        'record_key',
        'record_json',
      ]);
      const favorites = createRowBatcher(connection, 'favorites', [
        'username',
        'favorite_key',
        'favorite_json',
        ...FAVORITE_PROJECTION_COLUMNS,
      ]);
      const videoReviews = createRowBatcher(connection, 'video_reviews', [
        'username',
        'title_norm',
        'year',
        'review_json',
        'is_public',
        'updated_at',
      ]);
      const searchHistories = createRowBatcher(connection, 'search_history', [
        'username',
        'keyword',
        'sort_index',
      ]);
      const skipConfigs = createRowBatcher(connection, 'skip_configs', [
        'username',
        'config_key',
        'config_json',
      ]);
      const playbackSessions = createRowBatcher(
        connection,
        'playback_sessions',
        [
          'id',
          'username',
          'source',
          'video_id',
          'episode_index',
          'title',
          'source_name',
          'cover',
          'year',
          'started_at',
          'ended_at',
          'watch_seconds',
          'last_position',
          'total_time',
          'created_at',
          'updated_at',
        ],
      );

      for (const [userName, userData] of Object.entries(data.userData)) {
        const username = assertValidUsernameFormat(userName);

        if (userData.messageState) {
          await messageStates.add([
            username,
            JSON.stringify(userData.messageState),
          ]);
        }

        if (typeof userData.danmakuEnabled === 'boolean') {
          await danmakuSettings.add([
            username,
            userData.danmakuEnabled ? 1 : 0,
          ]);
        }

        if (typeof userData.lastLoginAt === 'number') {
          await loginActivities.add([username, userData.lastLoginAt]);
        }

        for (const [key, record] of Object.entries(userData.playRecords)) {
          await playRecords.add([username, key, JSON.stringify(record)]);
        }

        for (const [key, favorite] of Object.entries(userData.favorites)) {
          await favorites.add([
            username,
            key,
            JSON.stringify(favorite),
            ...favoriteProjection(key, JSON.stringify(favorite)),
          ]);
        }

        for (const review of userData.videoReviews ?? []) {
          await videoReviews.add([
            username,
            review.title_norm,
            review.year,
            JSON.stringify(review),
            review.is_public ? 1 : 0,
            review.updated_at,
          ]);
        }
        const searchHistory = userData.searchHistory.slice(
          0,
          searchHistoryLimit,
        );
        for (let index = 0; index < searchHistory.length; index++) {
          await searchHistories.add([username, searchHistory[index], index]);
        }

        for (const [key, config] of Object.entries(userData.skipConfigs)) {
          await skipConfigs.add([username, key, JSON.stringify(config)]);
        }

        for (const session of Object.values(userData.playbackSessions)) {
          await playbackSessions.add([
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
          ]);
        }
      }

      await messageStates.flush();
      await danmakuSettings.flush();
      await loginActivities.flush();
      await playRecords.flush();
      await favorites.flush();
      await videoReviews.flush();
      await searchHistories.flush();
      await skipConfigs.flush();
      await playbackSessions.flush();

      await this.importSocialData(connection, data);
      await new MysqlUserAccessStore(connection, true).migrate();
      await this.backfillMissingLoginActivity(connection);
      await this.backfillUserProfiles(connection);
    });
  }
}
