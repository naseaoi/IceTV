import 'server-only';

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

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
  favoriteProjection,
  libraryStatements,
} from '@/features/favorites/lib/library-storage';
import {
  type ConfigStateUpdate,
  type ConfigSubscription,
  sameSubscription,
  stripConfigState,
  subscriptionFromConfig,
} from '@/lib/config-state';
import {
  type InviteCodeQuery,
  importedInviteCodes,
  INVITE_INSERT_SQL,
  inviteValues,
} from '@/lib/invite-code-storage';
import {
  importedProfileValues,
  newProfileId,
  NicknameTakenError,
  ReviewSocialStorage,
  socialSchema,
} from '@/lib/review-social-storage';
import { SqliteConfigStateStore } from '@/lib/sqlite-config-state-store';
import { SqliteInviteCodeStore } from '@/lib/sqlite-invite-code-store';
import { SqliteResourceStore } from '@/lib/sqlite-resource-store';
import { SqliteUserAccessStore } from '@/lib/sqlite-user-access';
import {
  canManageUserAccess,
  removedAccessReferences,
  userAccessSchema,
} from '@/lib/user-access';
import { mergeUserMessageState } from '@/lib/user-message-state';
import { validateNickname } from '@/lib/user-profile';
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
import { buildTrackingSql, SQLITE_TRACKING_DIALECT } from './tracking-sql';
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
  SourceHealthSearchDaily,
  SourceHealthSearchDelta,
  SourcePlayReporterSummary,
  SourcePlayReportInput,
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
import {
  mergeSearchKeywords,
  pickNewerJson,
  planUsernameMigration,
} from './username-migration';

const SEARCH_HISTORY_LIMIT = 20;
const REVIEW_SQL = reviewSql('sqlite');

const {
  createdAt: SQLITE_TRACKING_CREATED_AT,
  unreadWhere: SQLITE_UNREAD_TRACKING_WHERE,
} = buildTrackingSql(SQLITE_TRACKING_DIALECT);

const SQLITE_STALE_PLAY_RECORD_WHERE = `
  CASE
    WHEN json_valid(record_json) = 0 THEN 1
    WHEN json_type(record_json, '$.metadata_checked_at') IS NULL THEN 1
    WHEN json_type(record_json, '$.metadata_checked_at') NOT IN ('integer', 'real') THEN 1
    WHEN CAST(json_extract(record_json, '$.metadata_checked_at') AS REAL) <= ? THEN 1
    WHEN CAST(json_extract(record_json, '$.metadata_checked_at') AS REAL) > ? THEN 1
    ELSE 0
  END = 1`;

const SQLITE_STALE_FAVORITE_WHERE = `
  CASE
    WHEN json_valid(favorite_json) = 0 THEN 1
    WHEN json_type(favorite_json, '$.metadata_checked_at') IS NULL THEN 1
    WHEN json_type(favorite_json, '$.metadata_checked_at') NOT IN ('integer', 'real') THEN 1
    WHEN CAST(json_extract(favorite_json, '$.metadata_checked_at') AS REAL) <= ? THEN 1
    WHEN CAST(json_extract(favorite_json, '$.metadata_checked_at') AS REAL) > ? THEN 1
    ELSE 0
  END = 1`;

const SQLITE_NON_LIVE_FAVORITE_WHERE = `
  CASE
    WHEN json_valid(favorite_json) = 0 THEN 1
    WHEN json_extract(favorite_json, '$.origin') = 'live' THEN 0
    ELSE 1
  END = 1`;

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
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (typeof message === 'string' && /unique constraint failed/i.test(message))
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

function buildMetadataRecordPage<T>(
  rows: Array<{ record_key: string; record_json: string }>,
  limit: number,
): MetadataRecordPage<T> {
  const pageRows = rows.slice(0, limit);
  const items = pageRows.flatMap((row) => {
    const parsed = parseJsonValue<T>(row.record_json);
    return !parsed
      ? []
      : [{ key: row.record_key, item: parsed, snapshot: row.record_json }];
  });
  const lastRow = pageRows.at(-1);

  return {
    items,
    nextCursor: rows.length > limit && lastRow ? lastRow.record_key : null,
  };
}

function buildMetadataFavoritePage(
  rows: Array<{ favorite_key: string; favorite_json: string }>,
  limit: number,
): MetadataRecordPage<Favorite> {
  const pageRows = rows.slice(0, limit);
  const items = pageRows.flatMap((row) => {
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
    nextCursor: rows.length > limit && lastRow ? lastRow.favorite_key : null,
  };
}

export class LocalSqliteStorage implements IStorage {
  // 额度池按 store 实例区分，必须复用同一个实例
  private resourceStore?: SqliteResourceStore;
  get resources() {
    return (this.resourceStore ??= new SqliteResourceStore(this.db));
  }
  private readonly dbPath: string;
  private readonly legacyJsonPaths: string[];
  private readonly db: Database.Database;

  // 预编译的 Prepared Statements
  private readonly stmts: {
    // play_records
    getPlayRecord: Database.Statement;
    setPlayRecord: Database.Statement;
    setPlayRecordIfUnchanged: Database.Statement;
    getAllPlayRecords: Database.Statement;
    getStalePlayRecordPage: Database.Statement;
    getStalePlayRecordPageAfter: Database.Statement;
    getPlayRecordPage: Database.Statement;
    getPlayRecordPageAfter: Database.Statement;
    countPlayRecords: Database.Statement;
    getUnreadTrackingPlayRecordPage: Database.Statement;
    getUnreadTrackingPlayRecordPageAfter: Database.Statement;
    countUnreadTrackingPlayRecords: Database.Statement;
    deletePlayRecord: Database.Statement;
    getVideoReview: Database.Statement;
    getLatestVideoReview: Database.Statement;
    setVideoReview: Database.Statement;
    deleteVideoReview: Database.Statement;
    deleteVideoReviewsByUser: Database.Statement;
    getAllVideoReviews: Database.Statement;
    getPublicVideoReviewsForWork: Database.Statement;
    getVideoReviewSummary: Database.Statement;
    getPublicVideoReviewPage: Database.Statement;
    // favorites
    getFavorite: Database.Statement;
    setFavorite: Database.Statement;
    setFavoriteIfUnchanged: Database.Statement;
    getAllFavorites: Database.Statement;
    getStaleFavoritePage: Database.Statement;
    getStaleFavoritePageAfter: Database.Statement;
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
    recordUserLogin: Database.Statement;
    getUserLastLogin: Database.Statement;
    getAllUserLastLogins: Database.Statement;
    deleteLoginActivityByUser: Database.Statement;
    backfillLoginActivity: Database.Statement;
    getDanmakuEpisodeId: Database.Statement;
    setDanmakuEpisodeId: Database.Statement;
    deleteDanmakuEpisodeId: Database.Statement;
    getDanmakuEnabledPreference: Database.Statement;
    setDanmakuEnabledPreference: Database.Statement;
    deleteDanmakuEnabledPreferenceByUser: Database.Statement;
    getSharedCache: Database.Statement;
    acquireSharedCacheLease: Database.Statement;
    setSharedCache: Database.Statement;
    releaseSharedCacheLease: Database.Statement;
    pruneSharedCache: Database.Statement;
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
    for (const statement of socialSchema('sqlite')) this.db.exec(statement);
    for (const statement of userAccessSchema('sqlite')) this.db.exec(statement);
    runWithBusyRetry('迁移 SQLite 用户头像', () => {
      this.migrateUserProfileAvatarSeed();
    });
    this.migrateFavoriteProjection();
    this.stmts = this.prepareStatements();
    if (!isMemoryDb) {
      runWithBusyRetry('迁移 SQLite 历史数据', () => {
        this.migrateFromLegacyJsonIfNeeded();
      });
      runWithBusyRetry('归一化 SQLite 用户名', () => {
        this.migrateLegacyUsernameCasing();
      });
      runWithBusyRetry('补齐 SQLite 用户活跃记录', () => {
        this.backfillMissingLoginActivity();
      });
      this.checkpointWal();
    }
    this.backfillFavoriteProjection();
    this.backfillUserProfiles();
    new SqliteUserAccessStore(this.db).migrate();
    this.invites.migrate();
    new SqliteConfigStateStore(this.db).migrate();
  }

  private migrateFavoriteProjection(): void {
    this.db
      .transaction(() => {
        const columns = this.db.pragma('table_info(favorites)') as {
          name: string;
        }[];
        for (const [name, type] of Object.entries({
          title_norm: 'TEXT',
          year_norm: 'TEXT',
          year_number: 'REAL',
          search_text: 'TEXT',
          saved_at: 'REAL',
          library_valid: 'INTEGER NOT NULL DEFAULT 0',
          projection_version: 'INTEGER NOT NULL DEFAULT 0',
        })) {
          if (!columns.some((column) => column.name === name))
            this.db.exec(`ALTER TABLE favorites ADD COLUMN ${name} ${type}`);
        }
        this.db
          .exec(`CREATE INDEX IF NOT EXISTS idx_favorites_saved ON favorites(username, saved_at, favorite_key);
        CREATE INDEX IF NOT EXISTS idx_favorites_work ON favorites(username, title_norm, year_norm);
        CREATE INDEX IF NOT EXISTS idx_favorites_projection ON favorites(projection_version);`);
      })
      .immediate();
  }

  private backfillFavoriteProjection(): void {
    const read = this.db.prepare(
      'SELECT username, favorite_key, favorite_json FROM favorites WHERE projection_version = 0 LIMIT 250',
    );
    const update = this.db.prepare(
      'UPDATE favorites SET title_norm = ?, year_norm = ?, year_number = ?, search_text = ?, saved_at = ?, library_valid = ?, projection_version = ? WHERE username = ? AND favorite_key = ?',
    );
    const batch = this.db.transaction(() => {
      const rows = read.all() as {
        username: string;
        favorite_key: string;
        favorite_json: string;
      }[];
      for (const row of rows)
        update.run(
          ...favoriteProjection(row.favorite_key, row.favorite_json),
          row.username,
          row.favorite_key,
        );
      return rows.length;
    });
    while (batch.immediate() > 0) {
      /* 每批提交，进程中断后从剩余行继续 */
    }
  }

  private migrateUserProfileAvatarSeed(): void {
    this.db
      .transaction(() => {
        const columns = this.db.pragma('table_info(user_profiles)') as {
          name: string;
        }[];
        if (!columns.some((column) => column.name === 'avatar_seed'))
          this.db.exec(
            'ALTER TABLE user_profiles ADD COLUMN avatar_seed VARCHAR(24)',
          );
      })
      .immediate();
  }

  private insertUserProfile(username: string, nickname?: string): void {
    const validated =
      nickname === undefined
        ? null
        : validateNickname(nickname, { allowReserved: true });
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        this.db
          .prepare(
            'INSERT INTO user_profiles (username, profile_id, nickname, nickname_norm, avatar_seed, favorites_public, updated_at) VALUES (?, ?, ?, ?, NULL, 0, ?)',
          )
          .run(
            username,
            newProfileId(),
            validated?.nickname ?? null,
            validated?.nicknameNorm ?? null,
            Date.now(),
          );
        return;
      } catch (error) {
        if (!isSqliteUniqueConstraintError(error)) throw error;
        if (
          validated &&
          this.db
            .prepare(
              'SELECT username FROM user_profiles WHERE nickname_norm = ?',
            )
            .get(validated.nicknameNorm)
        )
          throw new NicknameTakenError();
      }
    }
    throw new Error('无法分配用户资料标识');
  }

  private backfillUserProfiles(): void {
    const rows = this.db
      .prepare(
        'SELECT u.username FROM users u LEFT JOIN user_profiles p ON p.username = u.username WHERE p.username IS NULL',
      )
      .all() as { username: string }[];
    for (const row of rows)
      this.insertUserProfile(normalizeUsername(row.username));
  }

  // 每个用户都必须有活跃记录行，缺失的按当前时刻补齐
  private backfillMissingLoginActivity(): void {
    const result = this.stmts.backfillLoginActivity.run(Date.now());
    if (result.changes > 0) {
      console.log(`已补齐 ${result.changes} 个用户的活跃记录`);
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

      CREATE TABLE IF NOT EXISTS video_reviews (
        username TEXT NOT NULL,
        title_norm TEXT NOT NULL,
        year TEXT NOT NULL,
        review_json TEXT NOT NULL,
        is_public INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (username, title_norm, year)
      );
      CREATE INDEX IF NOT EXISTS idx_video_reviews_work ON video_reviews (title_norm, is_public, updated_at);
      CREATE INDEX IF NOT EXISTS idx_video_reviews_public ON video_reviews (is_public, updated_at);

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

      CREATE TABLE IF NOT EXISTS user_login_activity (
        username TEXT PRIMARY KEY,
        last_login_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config_subscription (
        id INTEGER PRIMARY KEY CHECK (id = 1), url TEXT NOT NULL,
        auto_update INTEGER NOT NULL, last_check TEXT NOT NULL, config_file TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_source_state (
        source_key TEXT PRIMARY KEY, channel_number INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invite_codes (
        code TEXT PRIMARY KEY COLLATE BINARY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        max_uses INTEGER,
        used_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_invite_codes_created ON invite_codes(created_at, code);
      CREATE INDEX IF NOT EXISTS idx_invite_codes_active ON invite_codes(expires_at, max_uses, used_count);

      CREATE TABLE IF NOT EXISTS invite_code_usage (
        code TEXT PRIMARY KEY,
        used_count INTEGER NOT NULL DEFAULT 0
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

      CREATE TABLE IF NOT EXISTS source_health_search (
        source TEXT NOT NULL,
        bucket_date TEXT NOT NULL,
        ok_count INTEGER NOT NULL DEFAULT 0,
        empty_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        latency_ms_sum REAL NOT NULL DEFAULT 0,
        latency_samples INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source, bucket_date)
      );
      CREATE INDEX IF NOT EXISTS idx_source_health_search_bucket
        ON source_health_search (bucket_date);

      CREATE TABLE IF NOT EXISTS source_health_play (
        source TEXT NOT NULL,
        bucket_date TEXT NOT NULL,
        reporter TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source, bucket_date, reporter)
      );
      CREATE INDEX IF NOT EXISTS idx_source_health_play_bucket
        ON source_health_play (bucket_date);

      CREATE TABLE IF NOT EXISTS user_danmaku_episodes (
        username TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        episode_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (username, scope_key)
      );

      CREATE TABLE IF NOT EXISTS user_danmaku_settings (
        username TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shared_resource_usage (
        resource_key TEXT PRIMARY KEY,
        used INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resource_usage_expiry ON shared_resource_usage (reset_at);
      CREATE TABLE IF NOT EXISTS shared_resource_leases (
        resource_key TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (resource_key, token)
      );
      CREATE INDEX IF NOT EXISTS idx_resource_lease_expiry ON shared_resource_leases (expires_at);

      CREATE TABLE IF NOT EXISTS shared_cache (
        cache_key TEXT PRIMARY KEY,
        value_text TEXT NOT NULL,
        fresh_until INTEGER NOT NULL,
        stale_until INTEGER NOT NULL,
        lease_token TEXT,
        lease_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_shared_cache_expiry
        ON shared_cache (stale_until, lease_until);

      CREATE INDEX IF NOT EXISTS idx_shared_cache_updated_at
        ON shared_cache (updated_at);
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
      setPlayRecordIfUnchanged: this.db.prepare(
        `UPDATE play_records
         SET record_json = ?
         WHERE username = ? AND record_key = ? AND record_json = ?`,
      ),
      getAllPlayRecords: this.db.prepare(
        'SELECT record_key, record_json FROM play_records WHERE username = ?',
      ),
      getStalePlayRecordPage: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ?
           AND ${SQLITE_STALE_PLAY_RECORD_WHERE}
         ORDER BY record_key ASC
         LIMIT ?`,
      ),
      getStalePlayRecordPageAfter: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ?
           AND record_key > ?
           AND ${SQLITE_STALE_PLAY_RECORD_WHERE}
         ORDER BY record_key ASC
         LIMIT ?`,
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
      getVideoReview: this.db.prepare(REVIEW_SQL.own),
      getLatestVideoReview: this.db.prepare(REVIEW_SQL.latest),
      setVideoReview: this.db.prepare(`INSERT INTO video_reviews
        (username, title_norm, year, review_json, is_public, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(username, title_norm, year) DO UPDATE SET
        review_json = json_set(excluded.review_json, '$.created_at', json_extract(video_reviews.review_json, '$.created_at')),
        is_public = excluded.is_public, updated_at = excluded.updated_at`),
      deleteVideoReview: this.db.prepare(REVIEW_SQL.delete),
      deleteVideoReviewsByUser: this.db.prepare(
        'DELETE FROM video_reviews WHERE username = ?',
      ),
      getAllVideoReviews: this.db.prepare(REVIEW_SQL.all),
      getPublicVideoReviewsForWork: this.db.prepare(REVIEW_SQL.work),
      getVideoReviewSummary: this.db.prepare(REVIEW_SQL.summary),
      getPublicVideoReviewPage: this.db.prepare(REVIEW_SQL.page),
      // favorites
      getFavorite: this.db.prepare(
        'SELECT favorite_json FROM favorites WHERE username = ? AND favorite_key = ?',
      ),
      setFavorite: this.db.prepare(
        'INSERT OR REPLACE INTO favorites (username, favorite_key, favorite_json, title_norm, year_norm, year_number, search_text, saved_at, library_valid, projection_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      setFavoriteIfUnchanged: this.db.prepare(
        `UPDATE favorites
         SET favorite_json = ?, title_norm = ?, year_norm = ?, year_number = ?, search_text = ?, saved_at = ?, library_valid = ?, projection_version = ?
         WHERE username = ? AND favorite_key = ? AND favorite_json = ?`,
      ),
      getAllFavorites: this.db.prepare(
        'SELECT favorite_key, favorite_json FROM favorites WHERE username = ?',
      ),
      getStaleFavoritePage: this.db.prepare(
        `SELECT favorite_key, favorite_json
         FROM favorites
         WHERE username = ?
           AND ${SQLITE_STALE_FAVORITE_WHERE}
           AND ${SQLITE_NON_LIVE_FAVORITE_WHERE}
         ORDER BY favorite_key ASC
         LIMIT ?`,
      ),
      getStaleFavoritePageAfter: this.db.prepare(
        `SELECT favorite_key, favorite_json
         FROM favorites
         WHERE username = ?
           AND favorite_key > ?
           AND ${SQLITE_STALE_FAVORITE_WHERE}
           AND ${SQLITE_NON_LIVE_FAVORITE_WHERE}
         ORDER BY favorite_key ASC
         LIMIT ?`,
      ),
      getFavoritePage: this.db.prepare(
        `SELECT f.favorite_key, f.favorite_json, p.record_json
         FROM favorites f
         LEFT JOIN play_records p
           ON p.username = f.username AND p.record_key = f.favorite_key
         WHERE f.username = ?
           AND (? = 1 OR ${SQLITE_NON_LIVE_FAVORITE_WHERE})
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
           AND (? = 1 OR ${SQLITE_NON_LIVE_FAVORITE_WHERE})
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
        `SELECT COUNT(*) AS count FROM favorites
         WHERE username = ? AND (? = 1 OR ${SQLITE_NON_LIVE_FAVORITE_WHERE})`,
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
      recordUserLogin: this.db.prepare(
        'INSERT OR REPLACE INTO user_login_activity (username, last_login_at) VALUES (?, ?)',
      ),
      getUserLastLogin: this.db.prepare(
        'SELECT last_login_at FROM user_login_activity WHERE username = ?',
      ),
      getAllUserLastLogins: this.db.prepare(
        'SELECT username, last_login_at FROM user_login_activity',
      ),
      deleteLoginActivityByUser: this.db.prepare(
        'DELETE FROM user_login_activity WHERE username = ?',
      ),
      backfillLoginActivity: this.db.prepare(
        'INSERT OR IGNORE INTO user_login_activity (username, last_login_at) SELECT username, ? FROM users',
      ),
      getDanmakuEpisodeId: this.db.prepare(
        'SELECT episode_id FROM user_danmaku_episodes WHERE username = ? AND scope_key = ?',
      ),
      setDanmakuEpisodeId: this.db.prepare(
        'INSERT OR REPLACE INTO user_danmaku_episodes (username, scope_key, episode_id, updated_at) VALUES (?, ?, ?, ?)',
      ),
      deleteDanmakuEpisodeId: this.db.prepare(
        'DELETE FROM user_danmaku_episodes WHERE username = ? AND scope_key = ?',
      ),
      getDanmakuEnabledPreference: this.db.prepare(
        'SELECT enabled FROM user_danmaku_settings WHERE username = ?',
      ),
      setDanmakuEnabledPreference: this.db.prepare(
        'INSERT OR REPLACE INTO user_danmaku_settings (username, enabled) VALUES (?, ?)',
      ),
      deleteDanmakuEnabledPreferenceByUser: this.db.prepare(
        'DELETE FROM user_danmaku_settings WHERE username = ?',
      ),
      getSharedCache: this.db.prepare(
        `SELECT value_text, fresh_until, stale_until, lease_until
         FROM shared_cache WHERE cache_key = ? LIMIT 1`,
      ),
      acquireSharedCacheLease: this.db.prepare(
        `INSERT INTO shared_cache (
           cache_key, value_text, fresh_until, stale_until,
           lease_token, lease_until, updated_at
         ) VALUES (?, '', 0, 0, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           lease_token = excluded.lease_token,
           lease_until = excluded.lease_until,
           updated_at = excluded.updated_at
         WHERE shared_cache.lease_until <= excluded.updated_at`,
      ),
      setSharedCache: this.db.prepare(
        `UPDATE shared_cache
         SET value_text = ?, fresh_until = ?, stale_until = ?,
             lease_token = NULL, lease_until = 0, updated_at = ?
         WHERE cache_key = ? AND lease_token = ?`,
      ),
      releaseSharedCacheLease: this.db.prepare(
        `UPDATE shared_cache
         SET lease_token = NULL, lease_until = 0
         WHERE cache_key = ? AND lease_token = ?`,
      ),
      pruneSharedCache: this.db.prepare(
        `DELETE FROM shared_cache
         WHERE cache_key IN (
           SELECT cache_key FROM shared_cache
           WHERE stale_until <= ? AND lease_until <= ?
           ORDER BY updated_at ASC LIMIT ?
         )`,
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
      'SELECT 1 AS v FROM user_danmaku_settings LIMIT 1',
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
        'INSERT OR REPLACE INTO favorites (username, favorite_key, favorite_json, title_norm, year_norm, year_number, search_text, saved_at, library_valid, projection_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
          insertFavorite.run(
            username,
            key,
            JSON.stringify(favorite),
            ...favoriteProjection(key, JSON.stringify(favorite)),
          );
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
        this.mergeSocialUsername(legacy, canonical);
        this.db
          .prepare(
            'UPDATE OR IGNORE user_access SET username = ? WHERE username = ?',
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM user_access WHERE username = ?')
          .run(legacy);
        this.db
          .prepare(
            'UPDATE OR IGNORE user_group_members SET username = ? WHERE username = ?',
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM user_group_members WHERE username = ?')
          .run(legacy);
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
        this.db
          .prepare(
            `INSERT INTO video_reviews
          (username, title_norm, year, review_json, is_public, updated_at)
          SELECT ?, title_norm, year, review_json, is_public, updated_at FROM video_reviews WHERE username = ?
          ON CONFLICT(username, title_norm, year) DO UPDATE SET
            review_json = excluded.review_json, is_public = excluded.is_public, updated_at = excluded.updated_at
          WHERE excluded.updated_at > video_reviews.updated_at`,
          )
          .run(canonical, legacy);
        this.stmts.deleteVideoReviewsByUser.run(legacy);
        this.mergeSearchHistory(legacy, canonical);
        this.mergeSingleRowTable(
          'user_message_state',
          'state_json',
          legacy,
          canonical,
        );
        this.mergeSingleRowTable(
          'user_danmaku_settings',
          'enabled',
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

  private mergeSocialUsername(legacy: string, canonical: string): void {
    const existing = this.db
      .prepare('SELECT username FROM user_profiles WHERE username = ?')
      .get(canonical);
    if (existing)
      this.db
        .prepare('DELETE FROM user_profiles WHERE username = ?')
        .run(legacy);
    else
      this.db
        .prepare('UPDATE user_profiles SET username = ? WHERE username = ?')
        .run(canonical, legacy);
    for (const [table, columns] of [
      ['user_follows', ['follower', 'followee']],
      ['video_review_likes', ['author', 'liker']],
      ['video_review_reports', ['author', 'reporter']],
    ] as const) {
      for (const column of columns) {
        this.db
          .prepare(
            `UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`,
          )
          .run(canonical, legacy);
        this.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(legacy);
      }
    }
    this.db.exec(
      'DELETE FROM user_follows WHERE follower = followee; DELETE FROM video_review_likes WHERE author = liker; DELETE FROM video_review_reports WHERE author = reporter;',
    );
  }

  private importSocialData(snapshot: StorageImportData): void {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [username, data] of Object.entries(snapshot.userData)) {
      this.db
        .prepare(
          'INSERT INTO user_profiles (username, profile_id, nickname, nickname_norm, avatar_seed, favorites_public, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(...importedProfileValues(username, data.profile, ids, names));
      for (const row of data.follows ?? [])
        this.db
          .prepare(
            'INSERT OR IGNORE INTO user_follows (follower, followee, created_at) VALUES (?, ?, ?)',
          )
          .run(
            normalizeUsername(username),
            normalizeUsername(row.followee),
            row.created_at,
          );
      for (const row of data.likes ?? [])
        this.db
          .prepare(
            'INSERT OR IGNORE INTO video_review_likes (author, title_norm, year, liker, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            normalizeUsername(row.author),
            row.title_norm,
            row.year,
            normalizeUsername(username),
            row.created_at,
          );
      for (const row of data.reports ?? [])
        this.db
          .prepare(
            'INSERT OR REPLACE INTO video_review_reports (author, title_norm, year, reporter, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            normalizeUsername(row.author),
            row.title_norm,
            row.year,
            normalizeUsername(username),
            row.reason,
            row.detail,
            row.created_at,
          );
    }
  }

  private collectDistinctUsernames(): string[] {
    const tables = [
      'users',
      'play_records',
      'favorites',
      'video_reviews',
      'user_profiles',
      'user_access',
      'user_group_members',
      'search_history',
      'skip_configs',
      'playback_sessions',
      'user_message_state',
      'user_danmaku_settings',
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
    for (const [table, columns] of [
      ['user_follows', ['follower', 'followee']],
      ['video_review_likes', ['author', 'liker']],
      ['video_review_reports', ['author', 'reporter']],
    ] as const) {
      for (const column of columns)
        for (const row of this.db
          .prepare(`SELECT DISTINCT ${column} AS username FROM ${table}`)
          .all() as { username: string }[])
          usernames.add(row.username);
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
      const json = pickNewerJson(canonicalRow?.json, row.json);
      if (table === 'favorites') {
        this.stmts.setFavorite.run(
          canonical,
          row.key,
          json,
          ...favoriteProjection(row.key, json),
        );
      } else {
        upsert.run(canonical, row.key, json);
      }
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

  async setPlayRecordIfUnchanged(
    userName: string,
    key: string,
    record: PlayRecord,
    snapshot: string,
  ): Promise<boolean> {
    const username = normalizeUsername(userName);
    const result = this.stmts.setPlayRecordIfUnchanged.run(
      JSON.stringify(record),
      username,
      key,
      snapshot,
    );
    return result.changes > 0;
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

  async getStalePlayRecordPage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<PlayRecord>> {
    const username = normalizeUsername(userName);
    const pageLimit = Math.max(1, Math.floor(limit));
    const staleBefore = now - ttlMs;
    const rows = (
      cursorKey !== undefined
        ? this.stmts.getStalePlayRecordPageAfter.all(
            username,
            cursorKey,
            staleBefore,
            now,
            pageLimit + 1,
          )
        : this.stmts.getStalePlayRecordPage.all(
            username,
            staleBefore,
            now,
            pageLimit + 1,
          )
    ) as Array<{ record_key: string; record_json: string }>;

    return buildMetadataRecordPage<PlayRecord>(rows, pageLimit);
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
    this.stmts.setFavorite.run(
      username,
      key,
      JSON.stringify(favorite),
      ...favoriteProjection(key, JSON.stringify(favorite)),
    );
  }

  async setFavoriteIfUnchanged(
    userName: string,
    key: string,
    favorite: Favorite,
    snapshot: string,
  ): Promise<boolean> {
    const username = normalizeUsername(userName);
    const result = this.stmts.setFavoriteIfUnchanged.run(
      JSON.stringify(favorite),
      ...favoriteProjection(key, JSON.stringify(favorite)),
      username,
      key,
      snapshot,
    );
    return result.changes > 0;
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

  async getStaleFavoritePage(
    userName: string,
    now: number,
    ttlMs: number,
    limit: number,
    cursorKey?: string,
  ): Promise<MetadataRecordPage<Favorite>> {
    const username = normalizeUsername(userName);
    const pageLimit = Math.max(1, Math.floor(limit));
    const staleBefore = now - ttlMs;
    const rows = (
      cursorKey !== undefined
        ? this.stmts.getStaleFavoritePageAfter.all(
            username,
            cursorKey,
            staleBefore,
            now,
            pageLimit + 1,
          )
        : this.stmts.getStaleFavoritePage.all(
            username,
            staleBefore,
            now,
            pageLimit + 1,
          )
    ) as Array<{ favorite_key: string; favorite_json: string }>;

    return buildMetadataFavoritePage(rows, pageLimit);
  }

  async getFavoritePage(
    userName: string,
    limit: number,
    cursorTime?: number,
    cursorKey?: string,
    includeLive = true,
  ): Promise<FavoritePage> {
    const username = normalizeUsername(userName);
    const rows = (
      cursorTime !== undefined && cursorKey
        ? this.stmts.getFavoritePageAfter.all(
            username,
            Number(includeLive),
            cursorTime,
            cursorTime,
            cursorKey,
            limit + 1,
          )
        : this.stmts.getFavoritePage.all(
            username,
            Number(includeLive),
            limit + 1,
          )
    ) as Array<{
      favorite_key: string;
      favorite_json: string;
      record_json?: string | null;
    }>;
    const countRow = this.stmts.countFavorites.get(
      username,
      Number(includeLive),
    ) as {
      count: number;
    };
    return buildFavoritePage(rows, countRow.count, limit);
  }

  async getFavoriteLibraryPage(userName: string, query: FavoriteLibraryQuery) {
    const username = normalizeUsername(userName);
    const sql = libraryStatements('sqlite', username, query);
    return this.db.transaction(() => {
      const counts = this.db
        .prepare(sql.counts)
        .get(...sql.countParams) as LibraryCountsRow;
      const rows = this.db
        .prepare(sql.page)
        .all(...sql.pageParams) as LibraryRow[];
      return buildLibraryPage(username, query, rows, counts);
    })();
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deleteFavorite.run(username, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deleteFavoritesByUser.run(username);
  }

  private get social() {
    return new ReviewSocialStorage({
      dialect: 'sqlite',
      rows: async <T>(sql: string, params: unknown[] = []) =>
        this.db.prepare(sql).all(...params) as T[],
      run: async (sql, params = []) =>
        this.db.prepare(sql).run(...params).changes,
    });
  }

  async getUserProfile(
    ...args: Parameters<IStorage['getUserProfile']>
  ): ReturnType<IStorage['getUserProfile']> {
    return this.social.getUserProfile(...args);
  }

  async getUserProfileById(
    ...args: Parameters<IStorage['getUserProfileById']>
  ): ReturnType<IStorage['getUserProfileById']> {
    return this.social.getUserProfileById(...args);
  }

  async ensureUserProfile(
    ...args: Parameters<IStorage['ensureUserProfile']>
  ): ReturnType<IStorage['ensureUserProfile']> {
    return this.social.ensureUserProfile(...args);
  }

  async updateUserProfile(
    ...args: Parameters<IStorage['updateUserProfile']>
  ): ReturnType<IStorage['updateUserProfile']> {
    return this.social.updateUserProfile(...args);
  }

  async isNicknameAvailable(
    ...args: Parameters<IStorage['isNicknameAvailable']>
  ): ReturnType<IStorage['isNicknameAvailable']> {
    return this.social.isNicknameAvailable(...args);
  }

  async getUserProfileView(
    ...args: Parameters<IStorage['getUserProfileView']>
  ): ReturnType<IStorage['getUserProfileView']> {
    return this.social.getUserProfileView(...args);
  }

  async setUserFollow(
    ...args: Parameters<IStorage['setUserFollow']>
  ): ReturnType<IStorage['setUserFollow']> {
    return this.social.setUserFollow(...args);
  }

  async getUserFollowPage(
    ...args: Parameters<IStorage['getUserFollowPage']>
  ): ReturnType<IStorage['getUserFollowPage']> {
    return this.social.getUserFollowPage(...args);
  }

  async getUserPublicReviewPage(
    ...args: Parameters<IStorage['getUserPublicReviewPage']>
  ): ReturnType<IStorage['getUserPublicReviewPage']> {
    return this.social.getUserPublicReviewPage(...args);
  }

  async setVideoReviewLike(
    ...args: Parameters<IStorage['setVideoReviewLike']>
  ): ReturnType<IStorage['setVideoReviewLike']> {
    return this.social.setVideoReviewLike(...args);
  }

  async reportVideoReview(
    ...args: Parameters<IStorage['reportVideoReview']>
  ): ReturnType<IStorage['reportVideoReview']> {
    return this.social.reportVideoReview(...args);
  }

  async getReviewReportPage(
    ...args: Parameters<IStorage['getReviewReportPage']>
  ): ReturnType<IStorage['getReviewReportPage']> {
    return this.social.getReviewReportPage(...args);
  }

  async getFollowReviewMessageCount(
    ...args: Parameters<IStorage['getFollowReviewMessageCount']>
  ): Promise<number> {
    return this.social.getFollowReviewMessageCount(...args);
  }

  async getFollowReviewMessages(
    ...args: Parameters<IStorage['getFollowReviewMessages']>
  ): ReturnType<IStorage['getFollowReviewMessages']> {
    return this.social.getFollowReviewMessages(...args);
  }

  async getUserSocialData(
    ...args: Parameters<IStorage['getUserSocialData']>
  ): ReturnType<IStorage['getUserSocialData']> {
    return this.social.getUserSocialData(...args);
  }

  async getVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
  ): Promise<VideoReview | null> {
    const username = normalizeUsername(userName);
    const row = (
      year
        ? this.stmts.getVideoReview.get(username, titleNorm, year, year, year)
        : this.stmts.getLatestVideoReview.get(username, titleNorm)
    ) as VideoReviewRow | undefined;
    return row ? (JSON.parse(row.review_json) as VideoReview) : null;
  }

  async setVideoReview(userName: string, review: VideoReview): Promise<void> {
    this.stmts.setVideoReview.run(
      normalizeUsername(userName),
      review.title_norm,
      review.year,
      JSON.stringify(review),
      review.is_public ? 1 : 0,
      review.updated_at,
    );
  }

  async deleteVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
    publicOnly = false,
  ): Promise<void> {
    this.db.transaction(() => {
      const result = this.stmts.deleteVideoReview.run(
        normalizeUsername(userName),
        titleNorm,
        year,
        publicOnly ? 1 : 0,
      );
      if (result.changes)
        this.deleteReviewSocialRows(
          normalizeUsername(userName),
          titleNorm,
          year,
        );
    })();
  }

  private deleteReviewSocialRows(
    author: string,
    title: string,
    year: string,
  ): void {
    for (const table of ['video_review_likes', 'video_review_reports'])
      this.db
        .prepare(
          `DELETE FROM ${table} WHERE author = ? AND title_norm = ? AND year = ?`,
        )
        .run(author, title, year);
  }

  async moderateReviewReports(
    author: string,
    title: string,
    year: string,
    action: 'dismiss' | 'mark-spoiler' | 'delete-review',
  ): Promise<void> {
    author = normalizeUsername(author);
    this.db.transaction(() => {
      const target = [author, title, year];
      if (
        !this.db
          .prepare(
            'SELECT username FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1',
          )
          .get(...target)
      )
        return;
      if (action === 'delete-review') {
        this.stmts.deleteVideoReview.run(...target, 1);
        this.deleteReviewSocialRows(author, title, year);
      } else {
        if (action === 'mark-spoiler')
          this.db
            .prepare(
              "UPDATE video_reviews SET review_json = json_set(review_json, '$.spoiler', json('true')) WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1",
            )
            .run(...target);
        this.db
          .prepare(
            'DELETE FROM video_review_reports WHERE author = ? AND title_norm = ? AND year = ?',
          )
          .run(...target);
      }
    })();
  }

  async getMyVideoReviewPage(
    ...args: Parameters<IStorage['getMyVideoReviewPage']>
  ): ReturnType<IStorage['getMyVideoReviewPage']> {
    return this.social.getMyVideoReviewPage(...args);
  }
  async getMyVideoReviewCount(
    ...args: Parameters<IStorage['getMyVideoReviewCount']>
  ): ReturnType<IStorage['getMyVideoReviewCount']> {
    return this.social.getMyVideoReviewCount(...args);
  }
  async getMyVideoReviewRatings(
    ...args: Parameters<IStorage['getMyVideoReviewRatings']>
  ): ReturnType<IStorage['getMyVideoReviewRatings']> {
    return this.social.getMyVideoReviewRatings(...args);
  }
  async getWorkVideoReviewPage(
    ...args: Parameters<IStorage['getWorkVideoReviewPage']>
  ): ReturnType<IStorage['getWorkVideoReviewPage']> {
    return this.social.getWorkVideoReviewPage(...args);
  }

  async getAllVideoReviews(userName: string): Promise<VideoReview[]> {
    const rows = this.stmts.getAllVideoReviews.all(
      normalizeUsername(userName),
    ) as VideoReviewRow[];
    return rows.map((row) => JSON.parse(row.review_json) as VideoReview);
  }

  async getPublicVideoReviewsForWork(
    titleNorm: string,
    year: string,
    viewer = '',
  ): Promise<WorkReviewSummary> {
    const result = this.db.transaction(() => {
      const summary = this.stmts.getVideoReviewSummary.get(
        titleNorm,
        year,
        year,
      ) as { average: number | null; count: number };
      const rows = this.stmts.getPublicVideoReviewsForWork.all(
        titleNorm,
        year,
        year,
      ) as VideoReviewRow[];
      return {
        average: summary.average,
        count: summary.count,
        rows,
        distribution: this.db
          .prepare(REVIEW_SQL.distribution)
          .all(titleNorm, year, year) as { bucket: number; count: number }[],
      };
    })();
    const distribution = Array<number>(10).fill(0);
    for (const row of result.distribution)
      distribution[Math.min(9, Math.max(0, Number(row.bucket) - 1))] += Number(
        row.count,
      );
    return {
      average: result.average,
      count: result.count,
      distribution,
      reviews: (await this.social.enrichReviews(result.rows, viewer)).map(
        publicReview,
      ),
    };
  }

  async getPublicVideoReviewPage(
    cursor?: string,
    q?: string,
  ): Promise<AdminVideoReviewPage> {
    const rows = this.stmts.getPublicVideoReviewPage.all(
      ...reviewPageParams(cursor, q),
    ) as VideoReviewRow[];
    return reviewPage(await this.social.enrichReviews(rows));
  }

  async registerUser(
    userName: string,
    password: string,
    nickname?: string,
  ): Promise<void> {
    const username = assertValidUsernameFormat(userName);
    if (this.stmts.checkUserExist.get(username)) {
      throw new Error('用户已存在');
    }
    const hashed = await hashPassword(password);
    try {
      this.registerUserWithActivity(username, hashed, Date.now(), nickname);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error)) {
        throw new Error('用户已存在');
      }
      throw error;
    }
  }

  // 建号与活跃记录同事务写入
  private registerUserWithActivity(
    username: string,
    hashedPassword: string,
    now: number,
    nickname?: string,
  ): void {
    this.db.transaction(() => {
      this.stmts.registerUser.run(username, hashedPassword);
      this.stmts.recordUserLogin.run(username, now);
      this.insertUserProfile(username, nickname);
      new SqliteUserAccessStore(this.db).put({ username, role: 'user' });
    })();
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

  async deleteUser(
    userName: string,
    permissions?: Parameters<IStorage['deleteUser']>[1],
  ): Promise<void> {
    if (!this.deleteManagedUser(userName, undefined, permissions))
      throw new Error('用户权限已变化，请刷新后重试');
  }

  async getUserAccess(username: string) {
    return new SqliteUserAccessStore(this.db).get(username);
  }

  async getAllUserAccess() {
    return new SqliteUserAccessStore(this.db).all();
  }

  async updateUserAccess(...args: Parameters<IStorage['updateUserAccess']>) {
    return new SqliteUserAccessStore(this.db).update(...args);
  }

  async removeUserGroup(group: string) {
    new SqliteUserAccessStore(this.db).removeGroup(group);
  }

  async removeUserSource(source: string) {
    new SqliteUserAccessStore(this.db).removeSource(source);
  }

  async deleteUserIfInactive(
    userName: string,
    before: number,
    operatorUsername: string,
  ): Promise<boolean> {
    return this.deleteManagedUser(userName, { before, operatorUsername });
  }

  private deleteManagedUser(
    userName: string,
    guard?: { before: number; operatorUsername: string },
    permissions?: Parameters<IStorage['deleteUser']>[1],
  ): boolean {
    const username = normalizeUsername(userName);
    const remove = this.db.transaction((targetUser: string) => {
      if (permissions) {
        const access = new SqliteUserAccessStore(this.db).get(targetUser);
        if (
          !access ||
          !canManageUserAccess(access, { ...permissions, excludeSelf: true })
        )
          return false;
      }
      if (guard) {
        const access = new SqliteUserAccessStore(this.db).get(targetUser);
        const activity = this.stmts.getUserLastLogin.get(targetUser) as
          | { last_login_at: number }
          | undefined;
        if (
          access?.role !== 'user' ||
          targetUser === normalizeUsername(guard.operatorUsername) ||
          !activity?.last_login_at ||
          activity.last_login_at > guard.before ||
          !this.stmts.checkUserExist.get(targetUser)
        )
          return false;
      }
      this.db
        .prepare('DELETE FROM user_profiles WHERE username = ?')
        .run(targetUser);
      this.db
        .prepare('DELETE FROM user_follows WHERE follower = ? OR followee = ?')
        .run(targetUser, targetUser);
      this.db
        .prepare('DELETE FROM video_review_likes WHERE author = ? OR liker = ?')
        .run(targetUser, targetUser);
      this.db
        .prepare(
          'DELETE FROM video_review_reports WHERE author = ? OR reporter = ?',
        )
        .run(targetUser, targetUser);
      this.db
        .prepare('DELETE FROM user_group_members WHERE username = ?')
        .run(targetUser);
      this.db
        .prepare('DELETE FROM user_access WHERE username = ?')
        .run(targetUser);
      this.stmts.deleteUserRow.run(targetUser);
      this.stmts.deletePlayRecordsByUser.run(targetUser);
      this.stmts.deleteFavoritesByUser.run(targetUser);
      this.stmts.deleteVideoReviewsByUser.run(targetUser);
      this.stmts.deleteSearchHistoryByUser.run(targetUser);
      this.stmts.deleteSkipConfigsByUser.run(targetUser);
      this.stmts.deletePlaybackSessionsByUser.run(targetUser);
      this.stmts.deleteUserMessageStateByUser.run(targetUser);
      this.stmts.deleteLoginActivityByUser.run(targetUser);
      this.db
        .prepare('DELETE FROM user_danmaku_episodes WHERE username = ?')
        .run(targetUser);
      this.stmts.deleteDanmakuEnabledPreferenceByUser.run(targetUser);
      return true;
    });
    return remove.immediate(username);
  }

  async recordUserLogin(userName: string, loginAt: number): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.recordUserLogin.run(username, loginAt);
  }

  async getUserLastLogin(userName: string): Promise<number | null> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getUserLastLogin.get(username) as
      | { last_login_at: number }
      | undefined;
    return row ? Number(row.last_login_at) : null;
  }

  async getAllUserLastLogins(): Promise<Record<string, number>> {
    const rows = this.stmts.getAllUserLastLogins.all() as {
      username: string;
      last_login_at: number;
    }[];
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.username] = Number(row.last_login_at);
    }
    return result;
  }

  private get invites() {
    return new SqliteInviteCodeStore(this.db);
  }

  async getAllInviteCodes() {
    return this.invites.all();
  }
  async queryInviteCodes(query: InviteCodeQuery) {
    return this.invites.page(query);
  }
  async countActiveInviteCodes() {
    return this.invites.countActive();
  }
  async createInviteCode(item: InviteCode) {
    return this.invites.create(item);
  }
  async deleteInviteCode(code: string) {
    return this.invites.delete(code);
  }
  async reserveInviteCodeUse(code: string): Promise<boolean> {
    return this.invites.reserve(code);
  }
  async releaseInviteCodeUse(code: string): Promise<void> {
    this.invites.release(code);
  }

  async getAllInviteCodeUsage(): Promise<Record<string, number>> {
    return Object.fromEntries(
      this.invites.all().map((item) => [item.code, item.usedCount || 0]),
    );
  }

  async deleteInviteCodeUsage(code: string): Promise<void> {
    this.invites.delete(code);
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

  async getAdminUserPage(query: AdminUserStorageQuery) {
    const sql = adminUserStatements('sqlite', query);
    return this.db.transaction(() => {
      const { total } = this.db.prepare(sql.count).get(...sql.countParams) as {
        total: number;
      };
      const rows = this.db
        .prepare(sql.rows)
        .all(...sql.params) as AdminUserRow[];
      return adminUserPage(rows, Number(total), sql.scope, sql.limit);
    })();
  }

  async getConfigSubscription(): Promise<ConfigSubscription> {
    return new SqliteConfigStateStore(this.db).subscription();
  }
  async getLiveSourceChannelCounts(): Promise<Record<string, number>> {
    return new SqliteConfigStateStore(this.db).counts();
  }
  async setLiveSourceChannelCount(
    source: NonNullable<AdminConfig['LiveConfig']>[number],
    count: number,
  ): Promise<void> {
    this.db
      .transaction(() => {
        const row = this.stmts.getAdminConfig.get() as
          | { config_json: string }
          | undefined;
        const config = row
          ? (JSON.parse(row.config_json) as AdminConfig)
          : null;
        const live = config?.LiveConfig?.find(
          (item) => item.key === source.key,
        );
        if (
          live &&
          live.url === source.url &&
          live.ua === source.ua &&
          live.epg === source.epg
        )
          new SqliteConfigStateStore(this.db).setCount(source.key, count);
      })
      .immediate();
  }

  async compareAndSetAdminConfig(
    expected: AdminConfig | null,
    config: AdminConfig,
    state?: ConfigStateUpdate,
  ): Promise<boolean> {
    return this.db
      .transaction(() => {
        const row = this.stmts.getAdminConfig.get() as
          | { config_json: string }
          | undefined;
        const current = row ? JSON.parse(row.config_json) : null;
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
        const stateStore = new SqliteConfigStateStore(this.db);
        if (
          state?.subscription &&
          !sameSubscription(
            stateStore.subscription(),
            state.subscription.expected,
          )
        )
          return false;
        const removed = removedAccessReferences(current, config);
        const access = new SqliteUserAccessStore(this.db);
        for (const group of removed.groups) access.removeGroup(group);
        for (const source of removed.sources) access.removeSource(source);
        stateStore.prune(current, config);
        for (const [key, count] of Object.entries(state?.liveCounts || {})) {
          if (config.LiveConfig?.some((live) => live.key === key))
            stateStore.setCount(key, count);
        }
        if (state?.subscription)
          stateStore.saveSubscription(state.subscription.next);
        if (JSON.stringify(current) !== JSON.stringify(config))
          this.stmts.setAdminConfig.run(JSON.stringify(config));
        return true;
      })
      .immediate();
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

  async updateUserMessageState(
    userName: string,
    update: UserMessageStateUpdate,
  ): Promise<UserMessageState> {
    const username = normalizeUsername(userName);
    return this.db
      .transaction(() => {
        const row = this.stmts.getUserMessageState.get(username) as
          | { state_json: string }
          | undefined;
        const next = mergeUserMessageState(
          parseJsonValue<UserMessageState>(row?.state_json) || {},
          update,
        );
        this.stmts.setUserMessageState.run(username, JSON.stringify(next));
        return next;
      })
      .immediate();
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

  async getDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<number | null> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getDanmakuEpisodeId.get(username, scopeKey) as
      | { episode_id: number }
      | undefined;
    return row ? row.episode_id : null;
  }

  async setDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
    episodeId: number,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.setDanmakuEpisodeId.run(
      username,
      scopeKey,
      episodeId,
      Date.now(),
    );
  }

  async deleteDanmakuEpisodeId(
    userName: string,
    scopeKey: string,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deleteDanmakuEpisodeId.run(username, scopeKey);
  }

  async getDanmakuEnabledPreference(userName: string): Promise<boolean | null> {
    const username = normalizeUsername(userName);
    const row = this.stmts.getDanmakuEnabledPreference.get(username) as
      | { enabled: number }
      | undefined;
    return row ? row.enabled !== 0 : null;
  }

  async setDanmakuEnabledPreference(
    userName: string,
    enabled: boolean,
  ): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.setDanmakuEnabledPreference.run(username, enabled ? 1 : 0);
  }

  async getSharedCache(key: string): Promise<SharedCacheRecord | null> {
    const row = this.stmts.getSharedCache.get(key) as
      | {
          value_text: string;
          fresh_until: number;
          stale_until: number;
          lease_until: number;
        }
      | undefined;
    if (!row) return null;
    return {
      value: row.value_text,
      freshUntil: row.fresh_until,
      staleUntil: row.stale_until,
      leaseUntil: row.lease_until,
    };
  }

  async acquireSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    return (
      this.stmts.acquireSharedCacheLease.run(key, token, leaseUntil, now)
        .changes > 0
    );
  }

  async setSharedCache(
    key: string,
    token: string,
    value: string,
    freshUntil: number,
    staleUntil: number,
    now: number,
  ): Promise<boolean> {
    return (
      this.stmts.setSharedCache.run(
        value,
        freshUntil,
        staleUntil,
        now,
        key,
        token,
      ).changes > 0
    );
  }

  async releaseSharedCacheLease(key: string, token: string): Promise<void> {
    this.stmts.releaseSharedCacheLease.run(key, token);
  }

  async pruneSharedCache(now: number, limit: number): Promise<void> {
    this.stmts.pruneSharedCache.run(
      now,
      now,
      Math.max(1, Math.min(1000, Math.floor(limit))),
    );
    this.db
      .prepare(
        `DELETE FROM shared_cache WHERE cache_key IN (
      SELECT cache_key FROM (
        SELECT cache_key,
          ROW_NUMBER() OVER (ORDER BY updated_at DESC, cache_key DESC) AS entry_rank,
          SUM(length(CAST(value_text AS BLOB))) OVER (ORDER BY updated_at DESC, cache_key DESC) AS cache_bytes
        FROM shared_cache WHERE lease_until <= ?
      ) AS budget WHERE entry_rank > 4096 OR cache_bytes > 134217728
    )`,
      )
      .run(now);
  }

  async renewSharedCacheLease(
    key: string,
    token: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    return (
      this.db
        .prepare(
          'UPDATE shared_cache SET lease_until = ? WHERE cache_key = ? AND lease_token = ? AND lease_until > ?',
        )
        .run(leaseUntil, key, token, now).changes > 0
    );
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

  async getPlaybackPeriodSessions(
    userName: string,
    start: number,
    end: number,
  ): Promise<PlaybackPeriodSession[]> {
    const username = normalizeUsername(userName);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [];
    return this.db
      .prepare(
        `SELECT source, video_id, title, cover, year, started_at, ended_at, watch_seconds
        FROM playback_sessions
        WHERE username = ? AND started_at >= ? AND started_at < ? AND watch_seconds > 0`,
      )
      .all(username, start, end) as PlaybackPeriodSession[];
  }

  async recordSourceHealthSearchBatch(
    rows: SourceHealthSearchDelta[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const count = (value: number) =>
      Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    this.db.transaction(() => {
      const statement = this.db.prepare(`INSERT INTO source_health_search (
        source, bucket_date, ok_count, empty_count, error_count, latency_ms_sum, latency_samples, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, bucket_date) DO UPDATE SET
        ok_count = ok_count + excluded.ok_count,
        empty_count = empty_count + excluded.empty_count,
        error_count = error_count + excluded.error_count,
        latency_ms_sum = latency_ms_sum + excluded.latency_ms_sum,
        latency_samples = latency_samples + excluded.latency_samples,
        updated_at = excluded.updated_at`);
      const now = Date.now();
      for (const row of rows) {
        const source = row.source.trim().slice(0, 191);
        if (!source) continue;
        statement.run(
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
        );
      }
    })();
  }

  async recordSourcePlayReport(input: SourcePlayReportInput): Promise<void> {
    const source = input.source.trim().slice(0, 191);
    const reporter = input.reporter.trim().slice(0, 191);
    if (!source || !reporter) return;
    this.db
      .prepare(
        `INSERT INTO source_health_play (
      source, bucket_date, reporter, success_count, failure_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, bucket_date, reporter) DO UPDATE SET
      success_count = success_count + excluded.success_count,
      failure_count = failure_count + excluded.failure_count,
      updated_at = excluded.updated_at`,
      )
      .run(
        source,
        input.bucketDate,
        reporter,
        input.success ? 1 : 0,
        input.success ? 0 : 1,
        Date.now(),
      );
  }

  async getSourceHealthSearchDaily(
    sinceDate: string,
  ): Promise<SourceHealthSearchDaily[]> {
    return this.db
      .prepare(
        `SELECT source, bucket_date AS bucketDate,
      ok_count AS okCount, empty_count AS emptyCount, error_count AS errorCount,
      latency_ms_sum AS latencyMsSum, latency_samples AS latencySamples
    FROM source_health_search WHERE bucket_date >= ?
    ORDER BY bucket_date ASC, source ASC`,
      )
      .all(sinceDate) as SourceHealthSearchDaily[];
  }

  async getSourcePlayReporterSummary(
    sinceDate: string,
  ): Promise<SourcePlayReporterSummary[]> {
    return this.db
      .prepare(
        `SELECT source,
      SUM(CASE WHEN success_count > 0 THEN 1 ELSE 0 END) AS successReporterDays,
      SUM(CASE WHEN success_count = 0 AND failure_count > 0 THEN 1 ELSE 0 END) AS failureReporterDays,
      MAX(CASE WHEN success_count > 0 THEN bucket_date ELSE NULL END) AS lastSuccessDate
    FROM source_health_play WHERE bucket_date >= ?
    GROUP BY source
    ORDER BY source ASC`,
      )
      .all(sinceDate) as SourcePlayReporterSummary[];
  }

  async purgeSourceHealthBefore(beforeDate: string): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM source_health_search WHERE bucket_date < ?')
        .run(beforeDate);
      this.db
        .prepare('DELETE FROM source_health_play WHERE bucket_date < ?')
        .run(beforeDate);
    })();
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
        DELETE FROM user_group_members;
        DELETE FROM user_access;
        DELETE FROM users;
        DELETE FROM play_records;
        DELETE FROM favorites;
        DELETE FROM video_reviews;
        DELETE FROM user_profiles;
        DELETE FROM user_follows;
        DELETE FROM video_review_likes;
        DELETE FROM video_review_reports;
        DELETE FROM search_history;
        DELETE FROM skip_configs;
        DELETE FROM playback_sessions;
        DELETE FROM admin_config;
        DELETE FROM source_route_stats;
        DELETE FROM source_health_search;
        DELETE FROM source_health_play;
        DELETE FROM user_message_state;
        DELETE FROM user_login_activity;
        DELETE FROM invite_code_usage;
        DELETE FROM invite_codes;
        DELETE FROM config_subscription;
        DELETE FROM live_source_state;
        DELETE FROM user_danmaku_episodes;
        DELETE FROM user_danmaku_settings;
        DELETE FROM shared_cache;
      `);
    });

    clear();
    console.log(`SQLite 数据库已清空: ${this.dbPath}`);
  }

  async replaceAllData(data: StorageImportData): Promise<void> {
    const searchHistoryLimit = normalizeRuntimeParam(
      'SearchHistoryLimit',
      data.adminConfig?.SiteConfig?.SearchHistoryLimit,
    );
    const replace = this.db.transaction((snapshot: StorageImportData) => {
      this.db.exec(`
        DELETE FROM user_group_members;
        DELETE FROM user_access;
        DELETE FROM users;
        DELETE FROM play_records;
        DELETE FROM favorites;
        DELETE FROM video_reviews;
        DELETE FROM user_profiles;
        DELETE FROM user_follows;
        DELETE FROM video_review_likes;
        DELETE FROM video_review_reports;
        DELETE FROM search_history;
        DELETE FROM skip_configs;
        DELETE FROM playback_sessions;
        DELETE FROM admin_config;
        DELETE FROM source_route_stats;
        DELETE FROM source_health_search;
        DELETE FROM source_health_play;
        DELETE FROM user_message_state;
        DELETE FROM user_login_activity;
        DELETE FROM invite_code_usage;
        DELETE FROM invite_codes;
        DELETE FROM config_subscription;
        DELETE FROM live_source_state;
        DELETE FROM user_danmaku_episodes;
        DELETE FROM user_danmaku_settings;
        DELETE FROM shared_cache;
      `);

      const inviteCodes = importedInviteCodes(
        snapshot.adminConfig.UserConfig?.InviteCodes,
        snapshot.inviteCodeUsage,
      );
      const storedConfig = JSON.parse(
        JSON.stringify(snapshot.adminConfig),
      ) as AdminConfig;
      if (storedConfig.UserConfig) delete storedConfig.UserConfig.InviteCodes;
      new SqliteConfigStateStore(this.db).saveSubscription(
        subscriptionFromConfig(storedConfig),
      );
      stripConfigState(storedConfig);
      this.stmts.setAdminConfig.run(JSON.stringify(storedConfig));
      const insertInvite = this.db.prepare(INVITE_INSERT_SQL);
      for (const item of inviteCodes) insertInvite.run(...inviteValues(item));

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
        if (typeof userData.danmakuEnabled === 'boolean') {
          this.stmts.setDanmakuEnabledPreference.run(
            username,
            userData.danmakuEnabled ? 1 : 0,
          );
        }
        if (typeof userData.lastLoginAt === 'number') {
          this.stmts.recordUserLogin.run(username, userData.lastLoginAt);
        }
        for (const [key, record] of Object.entries(userData.playRecords)) {
          this.stmts.setPlayRecord.run(username, key, JSON.stringify(record));
        }

        for (const [key, favorite] of Object.entries(userData.favorites)) {
          this.stmts.setFavorite.run(
            username,
            key,
            JSON.stringify(favorite),
            ...favoriteProjection(key, JSON.stringify(favorite)),
          );
        }

        for (const review of userData.videoReviews ?? []) {
          this.stmts.setVideoReview.run(
            username,
            review.title_norm,
            review.year,
            JSON.stringify(review),
            review.is_public ? 1 : 0,
            review.updated_at,
          );
        }

        userData.searchHistory
          .slice(0, searchHistoryLimit)
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

      this.importSocialData(snapshot);
      new SqliteUserAccessStore(this.db).migrate();
      this.backfillMissingLoginActivity();
      this.backfillUserProfiles();
    });

    replace(data);
  }
}
