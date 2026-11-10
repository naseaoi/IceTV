import 'server-only';

import type {
  ExecuteValues,
  PoolConnection,
  ResultSetHeader,
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
import {
  applyFavoriteStatus,
  batchSelection,
  mergeFavorite,
  mergeSelection,
  workSelection,
} from '@/features/favorites/lib/library-mutations';
import type {
  FavoriteBatchInput,
  FavoriteWorkQuery,
} from '@/features/favorites/lib/library-query';
import type { FavoriteLibraryQuery } from '@/features/favorites/lib/library-query';
import { libraryItem } from '@/features/favorites/lib/library-storage';
import {
  type LibraryCountsRow,
  type LibraryRow,
  buildLibraryPage,
  FAVORITE_PROJECTION_COLUMNS,
  favoriteProjection,
  libraryStatements,
} from '@/features/favorites/lib/library-storage';
import {
  type AnnouncementRow,
  ANNOUNCEMENT_INSERT_SQL,
  ANNOUNCEMENT_LIST_SQL,
  announcementUpdateQuery,
  publishedAnnouncementQuery,
  readAnnouncement,
} from '@/lib/announcement-storage';
import {
  type ConfigStateUpdate,
  type ConfigSubscription,
  sameSubscription,
} from '@/lib/config-state';
import {
  type InviteCodePurge,
  type InviteCodeQuery,
} from '@/lib/invite-code-storage';
import { MysqlConfigStateStore } from '@/lib/mysql-config-state-store';
import { MysqlInviteCodeStore } from '@/lib/mysql-invite-code-store';
import { MySqlResourceStore } from '@/lib/mysql-resource-store';
import { MysqlUserAccessStore } from '@/lib/mysql-user-access';
import {
  type OAuthBindResult,
  type OAuthIdentity,
  isOAuthDuplicate,
  OAUTH_INSERT,
  OAUTH_SCHEMA,
  oauthIdentityParams,
  readOAuthIdentity,
} from '@/lib/oauth-identity';
import { ReviewSocialStorage, socialSchema } from '@/lib/review-social-storage';
import {
  canManageUserAccess,
  removedAccessReferences,
  userAccessSchema,
} from '@/lib/user-access';
import {
  StoredUserDanmaku,
  storedUserDanmaku,
  USER_DANMAKU_INSERT,
  USER_DANMAKU_PROJECTION,
  userDanmakuPageSql,
  userDanmakuSchema,
  userDanmakuValues,
} from '@/lib/user-danmaku-storage';
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
import { getMySqlConnectionUrl } from './storage-type';
import { buildTrackingSql, MYSQL_TRACKING_DIALECT } from './tracking-sql';
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
  SiteAnnouncement,
  SkipConfig,
  SOURCE_ROUTE_STAT_STORAGE_MODES,
  SourceHealthSearchDaily,
  SourceHealthSearchDelta,
  SourcePlayReporterSummary,
  SourcePlayReportInput,
  SourceRouteStatInput,
  SourceRouteStatsBucket,
  SourceRouteStatsItem,
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
    // mysql2 的 0 表示不限；数据库阻塞时等待者会无界堆积在进程内
    queueLimit: parseInteger(
      process.env.MYSQL_QUEUE_LIMIT,
      connectionLimit * 50,
    ),
    ssl: buildSslOptions(),
  };
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
      OAUTH_SCHEMA + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
      ...socialSchema('mysql'),
      ...userDanmakuSchema('mysql'),
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
      `CREATE TABLE IF NOT EXISTS config_subscription (
        id TINYINT PRIMARY KEY, url TEXT NOT NULL, auto_update TINYINT NOT NULL,
        last_check TEXT NOT NULL, config_file LONGTEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
      `CREATE TABLE IF NOT EXISTS live_source_state (
        source_key VARCHAR(255) COLLATE utf8mb4_bin PRIMARY KEY,
        channel_number BIGINT NOT NULL, updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
      `CREATE TABLE IF NOT EXISTS announcements (
        id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        content TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        published_at BIGINT NULL,
        KEY idx_announcements_published (published_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
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
      `CREATE TABLE IF NOT EXISTS source_health_search (
        source VARCHAR(191) NOT NULL,
        bucket_date CHAR(10) NOT NULL,
        ok_count BIGINT NOT NULL DEFAULT 0,
        empty_count BIGINT NOT NULL DEFAULT 0,
        error_count BIGINT NOT NULL DEFAULT 0,
        latency_ms_sum DOUBLE NOT NULL DEFAULT 0,
        latency_samples BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (source, bucket_date),
        KEY idx_source_health_search_bucket (bucket_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS source_health_play (
        source VARCHAR(191) NOT NULL,
        bucket_date CHAR(10) NOT NULL,
        reporter VARCHAR(191) NOT NULL,
        success_count BIGINT NOT NULL DEFAULT 0,
        failure_count BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (source, bucket_date, reporter),
        KEY idx_source_health_play_bucket (bucket_date)
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
    for (const [table, index, columns] of [
      [
        'user_follows',
        'idx_follow_notifications',
        'followee, created_at, follower',
      ],
      [
        'video_review_likes',
        'idx_like_notifications',
        'author, created_at, title_norm, year',
      ],
    ]) {
      const [indexes] = await this.pool.query<RowDataPacket[]>(
        `SHOW INDEX FROM ${table}`,
      );
      if (indexes.some((row) => row.Key_name === index)) continue;
      try {
        await this.pool.execute(
          `CREATE INDEX ${index} ON ${table} (${columns})`,
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error;
      }
    }
    await this.migrateFavoriteProjection();
    await this.backfillMissingLoginActivity();
    await this.backfillUserProfiles();
    const accessConnection = await this.pool.getConnection();
    try {
      await accessConnection.beginTransaction();
      await new MysqlUserAccessStore(accessConnection, true).migrate();
      await new MysqlConfigStateStore(accessConnection).migrate();
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
      watch_status: 'VARCHAR(16) COLLATE utf8mb4_bin',
      watched_at: 'DOUBLE',
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
        'SELECT username, favorite_key, favorite_json FROM favorites WHERE projection_version < 2 LIMIT 250',
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        // CAS 防止回填覆盖同时发生的收藏更新；另一实例已经完成的行同样跳过。
        await this.pool.execute(
          `UPDATE favorites SET ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE username = ? AND favorite_key = ? AND projection_version < 2 AND BINARY favorite_json = BINARY ?`,
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
    filter?: 'updated',
  ): Promise<PlayRecordPage> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const saveTimeExpression =
      "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.save_time')) AS UNSIGNED)";
    const hasCursor = cursorTime !== undefined && !!cursorKey;
    const updatedWhere =
      filter === 'updated' ? ` AND ${MYSQL_UNREAD_TRACKING_WHERE}` : '';
    const rowsQuery = this.pool.query<JsonRow[]>(
      hasCursor
        ? `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?${updatedWhere}
             AND (${saveTimeExpression} < ?
               OR (${saveTimeExpression} = ? AND record_key < ?))
           ORDER BY ${saveTimeExpression} DESC, record_key DESC
           LIMIT ?`
        : `SELECT record_key, record_json
           FROM play_records
           WHERE username = ?${updatedWhere}
           ORDER BY ${saveTimeExpression} DESC, record_key DESC
           LIMIT ?`,
      hasCursor
        ? [username, cursorTime, cursorTime, cursorKey, limit + 1]
        : [username, limit + 1],
    );
    const countQuery = this.pool.query<
      Array<RowDataPacket & { count: number }>
    >(
      `SELECT COUNT(*) AS count FROM play_records WHERE username = ?${updatedWhere}`,
      [username],
    );
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

  async deletePlayRecords(userName: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.ensureInitialized();
    const uniqueKeys = [...new Set(keys)];
    await this.pool.execute(
      `DELETE FROM play_records WHERE username = ? AND record_key IN (${uniqueKeys.map(() => '?').join(', ')})`,
      [normalizeUsername(userName), ...uniqueKeys],
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE favorite_json = VALUES(favorite_json), ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = VALUES(${column})`).join(', ')}`,
      [
        username,
        key,
        JSON.stringify(favorite),
        ...favoriteProjection(key, JSON.stringify(favorite)),
      ],
    );
  }

  async saveMergedFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<string> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    await this.ensureUserProfile(username);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // 资料行充当每用户写锁，空收藏库中的并发目录/真实源写入同样串行。
      await connection.query(
        'SELECT username FROM user_profiles WHERE username = ? FOR UPDATE',
        [username],
      );
      const sql = mergeSelection(username, key, favorite);
      const [rows] = await connection.query<
        (RowDataPacket & { favorite_key: string; favorite_json: string })[]
      >(`${sql.sql} FOR UPDATE`, sql.params);
      const merged = mergeFavorite(key, favorite, rows);
      const json = JSON.stringify(merged.favorite);
      await connection.execute(
        `INSERT INTO favorites (username, favorite_key, favorite_json, ${FAVORITE_PROJECTION_COLUMNS.join(', ')}) VALUES (${Array(
          3 + FAVORITE_PROJECTION_COLUMNS.length,
        )
          .fill('?')
          .join(
            ',',
          )}) ON DUPLICATE KEY UPDATE favorite_json = VALUES(favorite_json), ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = VALUES(${column})`).join(', ')}`,
        [username, merged.key, json, ...favoriteProjection(merged.key, json)],
      );
      for (const remove of merged.removeKeys)
        await connection.execute(
          'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
          [username, remove],
        );
      await connection.commit();
      return merged.key;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async batchFavorites(
    userName: string,
    input: FavoriteBatchInput,
  ): Promise<{ affected: number }> {
    await this.ensureInitialized();
    const username = normalizeUsername(userName);
    const sql = batchSelection('mysql', username, input);
    await this.ensureUserProfile(username);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'SELECT username FROM user_profiles WHERE username = ? FOR UPDATE',
        [username],
      );
      const [rows] = await connection.query<(LibraryRow & RowDataPacket)[]>(
        `${sql.sql} FOR UPDATE`,
        sql.params,
      );
      const now = Date.now();
      for (const row of rows) {
        if (input.action === 'remove')
          await connection.execute(
            'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
            [username, row.favorite_key],
          );
        else {
          const json = JSON.stringify(
            applyFavoriteStatus(JSON.parse(row.favorite_json), input, now),
          );
          await connection.execute(
            `UPDATE favorites SET favorite_json = ?, ${FAVORITE_PROJECTION_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE username = ? AND favorite_key = ?`,
            [
              json,
              ...favoriteProjection(row.favorite_key, json),
              username,
              row.favorite_key,
            ],
          );
        }
      }
      await connection.commit();
      return { affected: rows.length };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getFavoriteForWork(userName: string, work: FavoriteWorkQuery) {
    await this.ensureInitialized();
    const sql = workSelection('mysql', normalizeUsername(userName), work);
    const [rows] = await this.pool.query<(LibraryRow & RowDataPacket)[]>(
      sql.sql,
      sql.params,
    );
    return rows[0] ? libraryItem(rows[0]) : null;
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
             AND favorite_key NOT LIKE 'douban+%' AND favorite_key NOT LIKE 'bangumi+%'
           ORDER BY favorite_key ASC
           LIMIT ?`
        : `SELECT favorite_key, favorite_json
           FROM favorites
           WHERE username = ?
             AND ${MYSQL_STALE_FAVORITE_WHERE}
             AND ${MYSQL_NON_LIVE_FAVORITE_WHERE}
             AND favorite_key NOT LIKE 'douban+%' AND favorite_key NOT LIKE 'bangumi+%'
           ORDER BY favorite_key ASC
           LIMIT ?`,
      hasCursor
        ? [username, cursorKey, staleBefore, now, pageLimit + 1]
        : [username, staleBefore, now, pageLimit + 1],
    );

    return buildMetadataFavoritePage(rows, pageLimit);
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

  async deleteReviewReply(
    id: string,
    username: string,
    admin = false,
  ): Promise<boolean> {
    return this.withTransaction(async (connection) => {
      const [result] = await connection.execute<
        import('mysql2/promise').ResultSetHeader
      >(
        'DELETE FROM video_review_replies WHERE id = ? AND (? = 1 OR username = ?)',
        [id, admin ? 1 : 0, normalizeUsername(username)],
      );
      if (result.affectedRows)
        await connection.execute(
          'DELETE FROM video_review_reply_reports WHERE reply_id = ?',
          [id],
        );
      return result.affectedRows > 0;
    });
  }
  async moderateReplyReports(
    id: string,
    action: 'dismiss' | 'delete-reply',
  ): Promise<void> {
    if (action === 'delete-reply') {
      await this.deleteReviewReply(id, '', true);
      return;
    }
    await this.ensureInitialized();
    await this.pool.execute(
      'DELETE FROM video_review_reply_reports WHERE reply_id = ?',
      [id],
    );
  }

  async getReviewReplies(
    ...args: Parameters<IStorage['getReviewReplies']>
  ): ReturnType<IStorage['getReviewReplies']> {
    await this.ensureInitialized();
    return this.socialFor().getReviewReplies(...args);
  }

  async postReviewReply(
    ...args: Parameters<IStorage['postReviewReply']>
  ): ReturnType<IStorage['postReviewReply']> {
    await this.ensureInitialized();
    return this.withTransaction(async (connection) => {
      await connection.query(
        'SELECT username FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? FOR UPDATE',
        [normalizeUsername(args[0]), args[1], args[2]],
      );
      return this.socialFor(connection).postReviewReply(...args);
    });
  }

  async reportReviewReply(
    ...args: Parameters<IStorage['reportReviewReply']>
  ): ReturnType<IStorage['reportReviewReply']> {
    await this.ensureInitialized();
    return this.withTransaction(async (connection) => {
      await connection.query(
        'SELECT id FROM video_review_replies WHERE id = ? FOR UPDATE',
        [args[0]],
      );
      return this.socialFor(connection).reportReviewReply(...args);
    });
  }

  async getReviewReplyMessages(
    ...args: Parameters<IStorage['getReviewReplyMessages']>
  ): ReturnType<IStorage['getReviewReplyMessages']> {
    await this.ensureInitialized();
    return this.socialFor().getReviewReplyMessages(...args);
  }

  async getReviewReplyMessageCount(
    ...args: Parameters<IStorage['getReviewReplyMessageCount']>
  ): ReturnType<IStorage['getReviewReplyMessageCount']> {
    await this.ensureInitialized();
    return this.socialFor().getReviewReplyMessageCount(...args);
  }

  async getPublicReview(
    ...args: Parameters<IStorage['getPublicReview']>
  ): ReturnType<IStorage['getPublicReview']> {
    await this.ensureInitialized();
    return this.socialFor().getPublicReview(...args);
  }

  async getSocialNotifications(
    ...args: Parameters<IStorage['getSocialNotifications']>
  ): ReturnType<IStorage['getSocialNotifications']> {
    await this.ensureInitialized();
    return this.socialFor().getSocialNotifications(...args);
  }

  async getSocialNotificationCount(
    ...args: Parameters<IStorage['getSocialNotificationCount']>
  ): ReturnType<IStorage['getSocialNotificationCount']> {
    await this.ensureInitialized();
    return this.socialFor().getSocialNotificationCount(...args);
  }

  async getUserSocialData(
    ...args: Parameters<IStorage['getUserSocialData']>
  ): ReturnType<IStorage['getUserSocialData']> {
    await this.ensureInitialized();
    return this.socialFor().getUserSocialData(...args);
  }

  async addUserDanmaku(item: StoredUserDanmaku): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(USER_DANMAKU_INSERT, userDanmakuValues(item));
  }
  async getUserDanmaku(
    episodeKey: string,
    limit: number,
  ): Promise<StoredUserDanmaku[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<(StoredUserDanmaku & RowDataPacket)[]>(
      `SELECT ${USER_DANMAKU_PROJECTION} FROM user_danmaku WHERE episode_key = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [episodeKey, limit],
    );
    return rows.map(storedUserDanmaku);
  }
  async getAllUserDanmaku(username: string): Promise<StoredUserDanmaku[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<(StoredUserDanmaku & RowDataPacket)[]>(
      `SELECT ${USER_DANMAKU_PROJECTION} FROM user_danmaku WHERE username = ? ORDER BY created_at DESC, id DESC`,
      [normalizeUsername(username)],
    );
    return rows.map(storedUserDanmaku);
  }
  async deleteUserDanmaku(id: string, username?: string): Promise<boolean> {
    await this.ensureInitialized();
    const [result] = await this.pool.execute<
      import('mysql2/promise').ResultSetHeader
    >(
      `DELETE FROM user_danmaku WHERE id = ?${username === undefined ? '' : ' AND username = ?'}`,
      username === undefined ? [id] : [id, normalizeUsername(username)],
    );
    return result.affectedRows > 0;
  }
  async getUserDanmakuPage(
    query: Parameters<IStorage['getUserDanmakuPage']>[0],
  ): Promise<StoredUserDanmaku[]> {
    await this.ensureInitialized();
    const { sql, params } = userDanmakuPageSql(query);
    const [rows] = await this.pool.query<(StoredUserDanmaku & RowDataPacket)[]>(
      sql,
      params,
    );
    return rows.map(storedUserDanmaku);
  }
  async deleteUserDanmakuBatch(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    await this.ensureInitialized();
    const [result] = await this.pool.execute<
      import('mysql2/promise').ResultSetHeader
    >(
      `DELETE FROM user_danmaku WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return result.affectedRows;
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
      if (result.affectedRows) {
        await connection.execute(
          'DELETE FROM video_review_reply_reports WHERE reply_id IN (SELECT id FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?)',
          target,
        );
        await connection.execute(
          'DELETE FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?',
          target,
        );
      }
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
          'DELETE FROM video_review_reply_reports WHERE reply_id IN (SELECT id FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?)',
          target,
        );
        await connection.execute(
          'DELETE FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?',
          target,
        );
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

  async getOAuthIdentity(id: string) {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM oauth_identities WHERE provider = 'linuxdo' AND provider_user_id = ?",
      [id],
    );
    return readOAuthIdentity(rows[0]);
  }
  async getUserOAuthIdentity(username: string) {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM oauth_identities WHERE provider = 'linuxdo' AND username = ?",
      [normalizeUsername(username)],
    );
    return readOAuthIdentity(rows[0]);
  }
  async bindOAuthIdentity(identity: OAuthIdentity): Promise<OAuthBindResult> {
    await this.ensureInitialized();
    const username = normalizeUsername(identity.username);
    try {
      return await this.withTransaction(async (connection) => {
        const [users] = await connection.query<RowDataPacket[]>(
          'SELECT username FROM users WHERE username = ? FOR UPDATE',
          [username],
        );
        if (!users.length) return 'user_missing' as const;
        await connection.execute(
          OAUTH_INSERT,
          oauthIdentityParams({ ...identity, username, autoCreated: false }),
        );
        return 'bound' as const;
      });
    } catch (error) {
      if (!isOAuthDuplicate(error)) throw error;
      const existing = await this.getOAuthIdentity(identity.providerUserId);
      if (existing)
        return existing.username === username ? 'bound' : 'identity_taken';
      return 'user_bound';
    }
  }
  async unbindOAuthIdentity(username: string): Promise<boolean> {
    await this.ensureInitialized();
    const [result] = await this.pool.execute<ResultSetHeader>(
      "DELETE FROM oauth_identities WHERE provider = 'linuxdo' AND username = ? AND auto_created = 0",
      [normalizeUsername(username)],
    );
    return result.affectedRows > 0;
  }
  async updateOAuthProviderUsername(id: string, name: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      "UPDATE oauth_identities SET provider_username = ? WHERE provider = 'linuxdo' AND provider_user_id = ?",
      [name, id],
    );
  }

  async registerUser(
    userName: string,
    password: string,
    nickname?: string,
    userGroups?: string[],
    identity?: import('@/lib/oauth-identity').OAuthIdentity,
  ): Promise<void> {
    await this.ensureInitialized();
    const username = assertValidUsernameFormat(userName);
    const hashed = await hashPassword(password);
    await this.withTransaction(async (connection) => {
      await connection.execute(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashed],
      );
      if (identity)
        await connection.execute(
          OAUTH_INSERT,
          oauthIdentityParams({ ...identity, username, autoCreated: true }),
        );
      await connection.execute(
        'INSERT INTO user_login_activity (username, last_login_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)',
        [username, Date.now()],
      );
      await this.socialFor(connection).ensureUserProfile(username);
      await new MysqlUserAccessStore(connection, true).put({
        username,
        role: 'user',
        tags: userGroups,
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
      await connection.execute(
        'DELETE FROM video_review_reply_reports WHERE reporter = ? OR reply_id IN (SELECT id FROM video_review_replies WHERE author = ? OR username = ?)',
        [username, username, username],
      );
      await connection.execute(
        'DELETE FROM video_review_replies WHERE author = ? OR username = ?',
        [username, username],
      );
      await connection.execute(
        'UPDATE video_review_replies SET reply_to = NULL WHERE reply_to = ?',
        [username],
      );
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
        'DELETE FROM oauth_identities WHERE username = ?',
        [username],
      );
      await connection.execute('DELETE FROM user_danmaku WHERE username = ?', [
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

  async listAnnouncements(limit: number): Promise<SiteAnnouncement[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<(RowDataPacket & AnnouncementRow)[]>(
      ANNOUNCEMENT_LIST_SQL,
      [limit],
    );
    return rows.map(readAnnouncement);
  }

  async countAnnouncements(): Promise<number> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<
      (RowDataPacket & { total: number | string })[]
    >('SELECT COUNT(*) AS total FROM announcements');
    return Number(rows[0]?.total ?? 0);
  }

  async getPublishedAnnouncements(
    options: Parameters<IStorage['getPublishedAnnouncements']>[0],
  ): Promise<SiteAnnouncement[]> {
    await this.ensureInitialized();
    const { sql, params } = publishedAnnouncementQuery(options);
    const [rows] = await this.pool.query<(RowDataPacket & AnnouncementRow)[]>(
      sql,
      params,
    );
    return rows.map(readAnnouncement);
  }

  async getAnnouncement(id: string): Promise<SiteAnnouncement | null> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<(RowDataPacket & AnnouncementRow)[]>(
      'SELECT * FROM announcements WHERE id = ?',
      [id],
    );
    return rows[0] ? readAnnouncement(rows[0]) : null;
  }

  async createAnnouncement(announcement: SiteAnnouncement): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(ANNOUNCEMENT_INSERT_SQL, [
      announcement.id,
      announcement.content,
      announcement.createdAt,
      announcement.updatedAt,
      announcement.publishedAt,
    ]);
  }

  async updateAnnouncement(
    id: string,
    patch: Parameters<IStorage['updateAnnouncement']>[1],
  ): Promise<SiteAnnouncement | null> {
    const { sql, params } = announcementUpdateQuery(id, patch);
    return this.withTransaction(async (connection) => {
      await connection.execute(sql, params);
      const [rows] = await connection.query<
        (RowDataPacket & AnnouncementRow)[]
      >('SELECT * FROM announcements WHERE id = ?', [id]);
      return rows[0] ? readAnnouncement(rows[0]) : null;
    });
  }

  async deleteAnnouncement(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const [result] = await this.pool.execute<ResultSetHeader>(
      'DELETE FROM announcements WHERE id = ?',
      [id],
    );
    return result.affectedRows > 0;
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
  async countInviteCodes() {
    await this.ensureInitialized();
    return this.invites.count();
  }
  async countActiveInviteCodes() {
    await this.ensureInitialized();
    return this.invites.countActive();
  }
  async createInviteCodes(items: InviteCode[]) {
    await this.ensureInitialized();
    return this.invites.create(items);
  }
  async createInviteCode(item: InviteCode) {
    return this.createInviteCodes([item]);
  }
  async deleteInviteCode(code: string) {
    await this.ensureInitialized();
    return this.invites.delete(code);
  }
  async purgeInviteCodes(options: InviteCodePurge) {
    await this.ensureInitialized();
    return this.invites.purge(options);
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

  async getConfigSubscription(): Promise<ConfigSubscription> {
    await this.ensureInitialized();
    return new MysqlConfigStateStore(this.pool).subscription();
  }
  async getLiveSourceChannelCounts(): Promise<Record<string, number>> {
    await this.ensureInitialized();
    return new MysqlConfigStateStore(this.pool).counts();
  }
  async setLiveSourceChannelCount(
    source: NonNullable<AdminConfig['LiveConfig']>[number],
    count: number,
  ): Promise<void> {
    await this.withTransaction(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
      );
      const config = rows[0]
        ? parseJsonValue<AdminConfig>(rows[0].config_json)
        : null;
      const live = config?.LiveConfig?.find((item) => item.key === source.key);
      if (
        live &&
        live.url === source.url &&
        live.ua === source.ua &&
        live.epg === source.epg
      )
        await new MysqlConfigStateStore(connection).setCount(source.key, count);
    });
  }

  async compareAndSetAdminConfig(
    expected: AdminConfig | null,
    config: AdminConfig,
    state?: ConfigStateUpdate,
  ): Promise<boolean> {
    return this.withTransaction(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
      );
      const current = rows[0]
        ? parseJsonValue<AdminConfig>(rows[0].config_json)
        : null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      const stateStore = new MysqlConfigStateStore(connection);
      if (
        state?.subscription &&
        !sameSubscription(
          await stateStore.subscription(true),
          state.subscription.expected,
        )
      )
        return false;
      const removed = removedAccessReferences(current, config);
      const access = new MysqlUserAccessStore(connection, true);
      for (const group of removed.groups) await access.removeGroup(group);
      for (const source of removed.sources) await access.removeSource(source);
      await stateStore.prune(current, config);
      for (const [key, count] of Object.entries(state?.liveCounts || {})) {
        if (config.LiveConfig?.some((live) => live.key === key))
          await stateStore.setCount(key, count);
      }
      if (state?.subscription)
        await stateStore.saveSubscription(state.subscription.next);
      if (JSON.stringify(current) !== JSON.stringify(config))
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
      `DELETE FROM shared_cache
       WHERE cache_key = ? AND lease_token = ?
         AND LENGTH(value_text) = 0 AND fresh_until = 0 AND stale_until = 0`,
      [key, token],
    );
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

  async recordSourceHealthSearchBatch(
    rows: SourceHealthSearchDelta[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const count = (value: number) =>
      Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    await this.withTransaction(async (connection) => {
      const now = Date.now();
      for (const row of rows) {
        const source = row.source.trim().slice(0, 191);
        if (!source) continue;
        await connection.execute(
          `INSERT INTO source_health_search (
          source, bucket_date, ok_count, empty_count, error_count, latency_ms_sum, latency_samples, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          ok_count = ok_count + VALUES(ok_count),
          empty_count = empty_count + VALUES(empty_count),
          error_count = error_count + VALUES(error_count),
          latency_ms_sum = latency_ms_sum + VALUES(latency_ms_sum),
          latency_samples = latency_samples + VALUES(latency_samples),
          updated_at = VALUES(updated_at)`,
          [
            source,
            row.bucketDate,
            count(row.okCount),
            count(row.emptyCount),
            count(row.errorCount),
            Number.isFinite(row.latencyMsSum) && row.latencyMsSum >= 0
              ? row.latencyMsSum
              : 0,
            count(row.latencySamples),
            now,
          ],
        );
      }
    });
  }

  async recordSourcePlayReport(input: SourcePlayReportInput): Promise<void> {
    const source = input.source.trim().slice(0, 191);
    const reporter = input.reporter.trim().slice(0, 191);
    if (!source || !reporter) return;
    await this.ensureInitialized();
    await this.pool.execute(
      `INSERT INTO source_health_play (
      source, bucket_date, reporter, success_count, failure_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      success_count = success_count + VALUES(success_count),
      failure_count = failure_count + VALUES(failure_count),
      updated_at = VALUES(updated_at)`,
      [
        source,
        input.bucketDate,
        reporter,
        input.success ? 1 : 0,
        input.success ? 0 : 1,
        Date.now(),
      ],
    );
  }

  async getSourceHealthSearchDaily(
    sinceDate: string,
  ): Promise<SourceHealthSearchDaily[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<
      (RowDataPacket & SourceHealthSearchDaily)[]
    >(
      `SELECT source, bucket_date AS bucketDate,
      ok_count AS okCount, empty_count AS emptyCount, error_count AS errorCount,
      latency_ms_sum AS latencyMsSum, latency_samples AS latencySamples
    FROM source_health_search WHERE bucket_date >= ?
    ORDER BY bucket_date ASC, source ASC`,
      [sinceDate],
    );
    return rows.map((row) => ({
      ...row,
      okCount: Number(row.okCount),
      emptyCount: Number(row.emptyCount),
      errorCount: Number(row.errorCount),
      latencyMsSum: Number(row.latencyMsSum),
      latencySamples: Number(row.latencySamples),
    }));
  }

  async getSourcePlayReporterSummary(
    sinceDate: string,
  ): Promise<SourcePlayReporterSummary[]> {
    await this.ensureInitialized();
    const [rows] = await this.pool.query<
      (RowDataPacket & SourcePlayReporterSummary)[]
    >(
      `SELECT source,
      SUM(CASE WHEN success_count > 0 THEN 1 ELSE 0 END) AS successReporterDays,
      SUM(CASE WHEN success_count = 0 AND failure_count > 0 THEN 1 ELSE 0 END) AS failureReporterDays,
      MAX(CASE WHEN success_count > 0 THEN bucket_date ELSE NULL END) AS lastSuccessDate
    FROM source_health_play WHERE bucket_date >= ?
    GROUP BY source
    ORDER BY source ASC`,
      [sinceDate],
    );
    return rows.map((row) => ({
      ...row,
      successReporterDays: Number(row.successReporterDays),
      failureReporterDays: Number(row.failureReporterDays),
    }));
  }

  async purgeSourceHealthBefore(beforeDate: string): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute(
        'DELETE FROM source_health_search WHERE bucket_date < ?',
        [beforeDate],
      );
      await connection.execute(
        'DELETE FROM source_health_play WHERE bucket_date < ?',
        [beforeDate],
      );
    });
  }

  async recordSourceRouteStat(input: SourceRouteStatInput): Promise<void> {
    await this.ensureInitialized();
    const source = input.source.trim().slice(0, 191);
    if (!source) return;
    const routeMode = SOURCE_ROUTE_STAT_STORAGE_MODES[input.routeMode];
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
        (row) =>
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.browser ||
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.server,
      )
      .map((row) => ({
        source: row.source || '',
        routeMode:
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.server
            ? 'server'
            : 'browser',
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }

  async purgeSourceRouteStatsBefore(beforeDate: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.execute(
      'DELETE FROM source_route_stats WHERE bucket_date < ?',
      [beforeDate],
    );
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
        (row) =>
          row.route_mode === 'browser' ||
          row.route_mode === 'server' ||
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.browser ||
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.server,
      )
      .map((row) => ({
        source: row.source || '',
        routeMode: row.route_mode as SourceRouteStatsBucket['routeMode'],
        bucketDate: row.bucket_date || '',
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }
}
