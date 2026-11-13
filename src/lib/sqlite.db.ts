import 'server-only';

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

import type { InviteCode } from '@/features/admin/services/inviteCodes';
import {
  type AdminUserRow,
  type AdminUserStorageQuery,
  adminUserPage,
  adminUserStatements,
} from '@/features/admin/services/userQueryStorage';
import {
  type TrackingCalendarRow,
  trackingCalendarItems,
  trackingCalendarSql,
} from '@/features/continue-watching/lib/tracking-calendar-storage';
import {
  favoriteMessageQueries,
  favoriteMessagesFromRows,
  favoriteReadStatement,
  favoriteTrackingStatement,
} from '@/features/favorites/lib/favorite-tracking';
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
  favoriteProjection,
  libraryStatements,
} from '@/features/favorites/lib/library-storage';
import {
  type ListPlan,
  type ListRow,
  ListPlans,
  listSchema,
} from '@/features/lists/lib/list-storage';
import { annualActivityPlan } from '@/features/playback-stats/lib/annual-activity-storage';
import {
  type PlaybackSourceUsage,
  type PlaybackSourceUsageRow,
  aggregateSourceUsage,
  sourceUsageSql,
} from '@/features/playback-stats/lib/source-usage';
import {
  ViewingHappinessPlans,
  viewingHappinessSchema,
} from '@/features/time-capsule/storage';
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
import {
  type OAuthBindResult,
  type OAuthIdentity,
  OAUTH_INSERT,
  OAUTH_SCHEMA,
  oauthIdentityParams,
  readOAuthIdentity,
} from '@/lib/oauth-identity';
import { SHELVED_PLAY_RECORD_AGE_MS } from '@/lib/play-records';
import {
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
  accessPermissionsKey,
  configPermissionsChanged,
} from '@/lib/user-notice';
import {
  type NoticeMutation,
  noticeInsert,
  NoticeModeration,
  userNoticeSchema,
  UserNoticeStorage,
} from '@/lib/user-notice-storage';
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
  ANNUAL_BUCKETS_SQL,
  ANNUAL_EARLIEST_SQL,
  ANNUAL_MESSAGE_EXISTS_SQL,
  ANNUAL_SESSIONS_SQL,
} from './playback-annual-storage';
import {
  buildPlaybackSearchLikePattern,
  normalizePlaybackSearchKeyword,
} from './playback-query';
import {
  buildShelvedPlayRecordWhere,
  buildTrackingSql,
  SQLITE_TRACKING_DIALECT,
} from './tracking-sql';
import {
  AdminVideoReviewPage,
  Favorite,
  IStorage,
  MetadataRecordPage,
  PlaybackAnnualData,
  PlaybackPeriodSession,
  PlaybackSession,
  PlaybackWatchBucket,
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
  WatchHistoryEntry,
  WatchHistoryQuery,
  WatchHistoryWrite,
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
    getUpdatedPlayRecordPage: Database.Statement;
    getUpdatedPlayRecordPageAfter: Database.Statement;
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
    setPlaybackSession: Database.Statement;
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
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as {
      name: string;
    }[];
    // 存量第三方自动建号的账号只有随机密码，迁移时标为未设密，用户可直接首次设置
    if (!userColumns.some((column) => column.name === 'password_set'))
      this.db.transaction(() => {
        this.db.exec(
          'ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1',
        );
        this.db.exec(
          'UPDATE users SET password_set = 0 WHERE username IN (SELECT username FROM oauth_identities WHERE auto_created = 1)',
        );
      })();
    for (const name of ['title', 'year']) {
      const columns = this.db
        .prepare('PRAGMA table_info(user_danmaku)')
        .all() as { name: string }[];
      if (!columns.some((column) => column.name === name))
        this.db.exec(
          `ALTER TABLE user_danmaku ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`,
        );
    }
    for (const statement of userNoticeSchema('sqlite')) this.db.exec(statement);
    for (const statement of viewingHappinessSchema('sqlite'))
      this.db.exec(statement);
    for (const statement of listSchema('sqlite')) this.db.exec(statement);
    runWithBusyRetry('迁移 SQLite 片单浏览量', () => {
      this.db
        .transaction(() => {
          const columns = this.db.pragma('table_info(user_lists)') as {
            name: string;
          }[];
          for (const column of ['view_count', 'like_count'])
            if (!columns.some((entry) => entry.name === column))
              this.db.exec(
                `ALTER TABLE user_lists ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`,
              );
        })
        .immediate();
    });
    for (const statement of socialSchema('sqlite')) this.db.exec(statement);
    for (const statement of userAccessSchema('sqlite')) this.db.exec(statement);
    runWithBusyRetry('迁移 SQLite 用户头像', () => {
      this.migrateUserProfileAvatarSeed();
    });
    this.migrateFavoriteProjection();
    this.migratePlaybackSchema();
    this.migrateReviewFirstPublished();
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
    this.migrateWatchHistory();
    this.backfillFavoriteProjection();
    this.backfillUserProfiles();
    new SqliteUserAccessStore(this.db).migrate();
    this.invites.migrate();
    new SqliteConfigStateStore(this.db).migrate();
  }

  private migrateReviewFirstPublished(): void {
    this.db
      .transaction(() => {
        const columns = this.db.pragma('table_info(video_reviews)') as {
          name: string;
        }[];
        if (!columns.some((column) => column.name === 'first_published_at'))
          this.db.exec(
            'ALTER TABLE video_reviews ADD COLUMN first_published_at INTEGER',
          );
        if (
          this.db
            .prepare('SELECT 1 FROM storage_migrations WHERE name = ?')
            .get('review_first_published_v1')
        )
          return;
        this.db.exec(
          'UPDATE video_reviews SET first_published_at = updated_at WHERE first_published_at IS NULL',
        );
        this.db
          .prepare(
            'INSERT INTO storage_migrations (name, completed_at) VALUES (?, ?)',
          )
          .run('review_first_published_v1', Date.now());
      })
      .immediate();
  }

  private migratePlaybackSchema(): void {
    this.db
      .transaction(() => {
        const columns = this.db.pragma('table_info(playback_sessions)') as {
          name: string;
        }[];
        if (!columns.some((column) => column.name === 'measurement_version'))
          this.db.exec(
            'ALTER TABLE playback_sessions ADD COLUMN measurement_version INTEGER NOT NULL DEFAULT 1',
          );
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS storage_migrations (name TEXT PRIMARY KEY, completed_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS playback_watch_buckets (
          username TEXT NOT NULL, session_id TEXT NOT NULL, bucket_start INTEGER NOT NULL,
          watch_ms INTEGER NOT NULL, PRIMARY KEY (username, session_id, bucket_start)
        );
        CREATE INDEX IF NOT EXISTS idx_watch_buckets_user_time ON playback_watch_buckets(username, bucket_start);
        CREATE TABLE IF NOT EXISTS watch_history (
          username TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, video_id TEXT NOT NULL,
          title TEXT NOT NULL, source_name TEXT NOT NULL, cover TEXT NOT NULL, year TEXT NOT NULL,
          episode_index INTEGER NOT NULL, total_episodes INTEGER NOT NULL,
          group_label TEXT, group_index INTEGER, group_total INTEGER,
          position REAL NOT NULL, duration REAL NOT NULL,
          first_watched_at INTEGER NOT NULL, last_watched_at INTEGER NOT NULL,
          PRIMARY KEY (username, id), UNIQUE (username, source, video_id)
        );
        CREATE INDEX IF NOT EXISTS idx_watch_history_page ON watch_history(username, last_watched_at, id);
      `);
      })
      .immediate();
  }

  private migrateWatchHistory(): void {
    // 完成标记与回填同事务提交，重启不会复活已删除的历史。
    this.db
      .transaction(() => {
        if (
          this.db
            .prepare('SELECT 1 FROM storage_migrations WHERE name = ?')
            .get('watch_history_v1')
        )
          return;
        const rows = this.db
          .prepare(
            `SELECT ranked.*, p.record_json FROM (
        SELECT s.*, MIN(started_at) OVER (PARTITION BY username, source, video_id) AS first_watched_at,
          ROW_NUMBER() OVER (PARTITION BY username, source, video_id ORDER BY updated_at DESC, id DESC) AS row_num
        FROM playback_sessions s WHERE watch_seconds > 0
      ) ranked LEFT JOIN play_records p ON p.username = ranked.username AND p.record_key = ranked.source || '+' || ranked.video_id
      WHERE ranked.row_num = 1`,
          )
          .all() as (PlaybackSession & {
          username: string;
          first_watched_at: number;
          record_json: string | null;
        })[];
        for (const row of rows) {
          let record: Partial<PlayRecord> = {};
          try {
            record = JSON.parse(row.record_json || '{}') ?? {};
          } catch {
            // 无效旧记录不阻塞迁移。
          }
          this.db
            .prepare(
              `INSERT INTO watch_history (
          username, id, source, video_id, title, source_name, cover, year, episode_index,
          total_episodes, group_label, group_index, group_total, position, duration, first_watched_at, last_watched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
            )
            .run(
              row.username,
              randomUUID(),
              row.source,
              row.video_id,
              row.title,
              row.source_name,
              row.cover,
              row.year,
              row.episode_index,
              record.total_episodes || Math.max(1, row.episode_index),
              record.group_label ?? null,
              record.group_index ?? null,
              record.group_total ?? null,
              row.last_position,
              row.total_time,
              row.first_watched_at,
              row.updated_at,
            );
        }
        this.db
          .prepare(
            'INSERT INTO storage_migrations (name, completed_at) VALUES (?, ?)',
          )
          .run('watch_history_v1', Date.now());
      })
      .immediate();
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
          watch_status: 'TEXT',
          watched_at: 'REAL',
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
      'SELECT username, favorite_key, favorite_json FROM favorites WHERE projection_version < 2 LIMIT 250',
    );
    const update = this.db.prepare(
      'UPDATE favorites SET title_norm = ?, year_norm = ?, year_number = ?, search_text = ?, saved_at = ?, library_valid = ?, watch_status = ?, watched_at = ?, projection_version = ? WHERE username = ? AND favorite_key = ?',
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
        password TEXT NOT NULL,
        password_set INTEGER NOT NULL DEFAULT 1
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

      ${userDanmakuSchema('sqlite').join(';')};
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

      ${OAUTH_SCHEMA};
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
      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY COLLATE BINARY,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at, id);

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

      CREATE TABLE IF NOT EXISTS invite_code_redemptions (
        username TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        redeemed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_invite_code_redemptions_code ON invite_code_redemptions(code);

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
      getUpdatedPlayRecordPage: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ? AND ${SQLITE_UNREAD_TRACKING_WHERE}
         ORDER BY CAST(json_extract(record_json, '$.save_time') AS INTEGER) DESC,
                  record_key DESC
         LIMIT ?`,
      ),
      getUpdatedPlayRecordPageAfter: this.db.prepare(
        `SELECT record_key, record_json
         FROM play_records
         WHERE username = ? AND ${SQLITE_UNREAD_TRACKING_WHERE}
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
        (username, title_norm, year, review_json, is_public, updated_at, first_published_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username, title_norm, year) DO UPDATE SET
        review_json = json_set(excluded.review_json, '$.created_at', json_extract(video_reviews.review_json, '$.created_at')),
        first_published_at = COALESCE(video_reviews.first_published_at, excluded.first_published_at),
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
        'INSERT OR REPLACE INTO favorites (username, favorite_key, favorite_json, title_norm, year_norm, year_number, search_text, saved_at, library_valid, watch_status, watched_at, projection_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      setFavoriteIfUnchanged: this.db.prepare(
        `UPDATE favorites
         SET favorite_json = ?, title_norm = ?, year_norm = ?, year_number = ?, search_text = ?, saved_at = ?, library_valid = ?, watch_status = ?, watched_at = ?, projection_version = ?
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
             AND favorite_key NOT LIKE 'douban+%' AND favorite_key NOT LIKE 'bangumi+%'
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
             AND favorite_key NOT LIKE 'douban+%' AND favorite_key NOT LIKE 'bangumi+%'
         ORDER BY favorite_key ASC
         LIMIT ?`,
      ),
      deleteFavorite: this.db.prepare(
        'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
      ),
      // users
      registerUser: this.db.prepare(
        'INSERT INTO users (username, password, password_set) VALUES (?, ?, ?)',
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
      setPlaybackSession: this.db.prepare(
        `INSERT INTO playback_sessions (
          id, username, source, video_id, episode_index, title, source_name,
          cover, year, started_at, ended_at, watch_seconds, last_position,
          total_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
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
          updated_at = excluded.updated_at
        WHERE playback_sessions.username = excluded.username AND playback_sessions.measurement_version = 1`,
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
      'SELECT 1 AS v FROM watch_history LIMIT 1',
      'SELECT 1 AS v FROM playback_watch_buckets LIMIT 1',
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
        'INSERT OR REPLACE INTO favorites (username, favorite_key, favorite_json, title_norm, year_norm, year_number, search_text, saved_at, library_valid, watch_status, watched_at, projection_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        this.db
          .prepare('UPDATE time_capsules SET username = ? WHERE username = ?')
          .run(canonical, legacy);
        this.db
          .prepare(
            'INSERT INTO work_completions (username, title_norm, year, celebrated_at) SELECT ?, title_norm, year, celebrated_at FROM work_completions WHERE username = ? ON CONFLICT(username, title_norm, year) DO UPDATE SET celebrated_at = MIN(work_completions.celebrated_at, excluded.celebrated_at)',
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM work_completions WHERE username = ?')
          .run(legacy);
        this.mergeUserRow(legacy, canonical);
        this.mergeSocialUsername(legacy, canonical);
        const likedLists = this.db
          .prepare('SELECT list_id FROM list_likes WHERE username = ?')
          .all(legacy) as { list_id: string }[];
        this.db
          .prepare(
            'UPDATE OR IGNORE list_likes SET username = ? WHERE username = ?',
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM list_likes WHERE username = ?')
          .run(legacy);
        for (const { list_id } of likedLists)
          this.db
            .prepare(
              'UPDATE user_lists SET like_count = (SELECT COUNT(*) FROM list_likes WHERE list_id = ?) WHERE id = ?',
            )
            .run(list_id, list_id);
        this.db
          .prepare('UPDATE user_lists SET username = ? WHERE username = ?')
          .run(canonical, legacy);
        this.db
          .prepare(
            `INSERT INTO user_annual_recaps (username, year, time_zone, hide_rhythm, report_json, published_at, updated_at)
          SELECT ?, year, time_zone, hide_rhythm, report_json, published_at, updated_at FROM user_annual_recaps WHERE username = ?
          ON CONFLICT(username, year) DO UPDATE SET time_zone = excluded.time_zone, hide_rhythm = excluded.hide_rhythm, report_json = excluded.report_json, published_at = excluded.published_at, updated_at = excluded.updated_at
          WHERE excluded.updated_at > user_annual_recaps.updated_at`,
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM user_annual_recaps WHERE username = ?')
          .run(legacy);
        this.db
          .prepare(
            'UPDATE OR IGNORE oauth_identities SET username = ? WHERE username = ?',
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM oauth_identities WHERE username = ?')
          .run(legacy);
        this.db
          .prepare('UPDATE user_danmaku SET username = ? WHERE username = ?')
          .run(canonical, legacy);
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
          (username, title_norm, year, review_json, is_public, updated_at, first_published_at)
          SELECT ?, title_norm, year, review_json, is_public, updated_at, first_published_at FROM video_reviews WHERE username = ?
          ON CONFLICT(username, title_norm, year) DO UPDATE SET
            review_json = excluded.review_json, is_public = excluded.is_public, updated_at = excluded.updated_at,
            first_published_at = CASE WHEN video_reviews.first_published_at IS NULL THEN excluded.first_published_at WHEN excluded.first_published_at IS NULL THEN video_reviews.first_published_at ELSE MIN(video_reviews.first_published_at, excluded.first_published_at) END
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
            `INSERT INTO playback_watch_buckets (username, session_id, bucket_start, watch_ms)
          SELECT ?, session_id, bucket_start, watch_ms FROM playback_watch_buckets WHERE username = ?
          ON CONFLICT(username, session_id, bucket_start) DO UPDATE SET watch_ms = MAX(watch_ms, excluded.watch_ms)`,
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM playback_watch_buckets WHERE username = ?')
          .run(legacy);
        this.db
          .prepare(
            `DELETE FROM watch_history AS canonical WHERE username = ? AND EXISTS (
          SELECT 1 FROM watch_history AS legacy WHERE legacy.username = ?
          AND (legacy.id = canonical.id OR (legacy.source = canonical.source AND legacy.video_id = canonical.video_id))
          AND legacy.last_watched_at > canonical.last_watched_at
        )`,
          )
          .run(canonical, legacy);
        this.db
          .prepare(
            'UPDATE OR IGNORE watch_history SET username = ? WHERE username = ?',
          )
          .run(canonical, legacy);
        this.db
          .prepare('DELETE FROM watch_history WHERE username = ?')
          .run(legacy);
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
      ['user_notice_events', ['recipient_username']],
      ['user_follows', ['follower', 'followee']],
      ['video_review_likes', ['author', 'liker']],
      ['video_review_reports', ['author', 'reporter']],
      ['video_review_replies', ['author', 'username', 'reply_to']],
      ['video_review_reply_reports', ['reporter']],
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

  private collectDistinctUsernames(): string[] {
    const tables = [
      'users',
      'play_records',
      'favorites',
      'video_reviews',
      'oauth_identities',
      'user_danmaku',
      'user_profiles',
      'user_lists',
      'list_likes',
      'user_access',
      'user_group_members',
      'search_history',
      'skip_configs',
      'playback_sessions',
      'watch_history',
      'playback_watch_buckets',
      'user_message_state',
      'user_annual_recaps',
      'time_capsules',
      'work_completions',
      'user_danmaku_settings',
    ];
    const usernames = new Set<string>();
    for (const table of tables) {
      const rows = this.db
        .prepare(`SELECT DISTINCT username FROM ${table}`)
        .all() as { username: string }[];
      for (const row of rows) {
        if (row.username) {
          if (row.username) usernames.add(row.username);
        }
      }
    }
    for (const [table, columns] of [
      ['user_notice_events', ['recipient_username']],
      ['user_follows', ['follower', 'followee']],
      ['video_review_likes', ['author', 'liker']],
      ['video_review_reports', ['author', 'reporter']],
      ['video_review_replies', ['author', 'username', 'reply_to']],
      ['video_review_reply_reports', ['reporter']],
    ] as const) {
      for (const column of columns)
        for (const row of this.db
          .prepare(`SELECT DISTINCT ${column} AS username FROM ${table}`)
          .all() as { username: string }[])
          if (row.username) usernames.add(row.username);
    }
    return [...usernames];
  }

  // 规范行已存在时保留其密码，避免覆盖用户当前在用的凭据
  private mergeUserRow(legacy: string, canonical: string): void {
    this.db
      .prepare(
        `INSERT INTO users (username, password, password_set)
         SELECT ?, password, password_set FROM users WHERE username = ?
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

  async getLatestPlayRecordByTitle(
    userName: string,
    title: string,
    year: string,
  ): Promise<Record<string, PlayRecord>> {
    const { findLatestPlayRecordKeyByTitle } =
      await import('@/lib/play-record-title');
    const username = normalizeUsername(userName);
    const key = await findLatestPlayRecordKeyByTitle(
      title,
      year,
      async (offset, limit) =>
        this.db
          .prepare(
            `SELECT record_key, json_extract(record_json, '$.title') AS title,
        json_extract(record_json, '$.year') AS year FROM play_records WHERE username = ?
        ORDER BY CAST(json_extract(record_json, '$.save_time') AS REAL) DESC, record_key DESC LIMIT ? OFFSET ?`,
          )
          .all(
            username,
            limit,
            offset,
          ) as import('@/lib/play-record-title').PlayRecordTitleRow[],
    );
    return key ? this.getPlayRecordsByKeys(username, [key]) : {};
  }

  async getPlayRecordsByKeys(
    userName: string,
    keys: string[],
  ): Promise<Record<string, PlayRecord>> {
    const uniqueKeys = [...new Set(keys)];
    if (!uniqueKeys.length) return {};
    const rows = this.db
      .prepare(
        `SELECT record_key, record_json FROM play_records WHERE username = ? AND record_key IN (${uniqueKeys.map(() => '?').join(', ')})`,
      )
      .all(normalizeUsername(userName), ...uniqueKeys) as {
      record_key: string;
      record_json: string;
    }[];
    const result: Record<string, PlayRecord> = {};
    for (const row of rows) {
      const record = parseJsonValue<PlayRecord>(row.record_json);
      if (record) result[row.record_key] = record;
    }
    return result;
  }

  async getPlayRecordSnapshot(
    userName: string,
    key: string,
  ): Promise<string | null> {
    const row = this.stmts.getPlayRecord.get(
      normalizeUsername(userName),
      key,
    ) as { record_json: string } | undefined;
    return row?.record_json ?? null;
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
    snapshot: string | null,
  ): Promise<boolean> {
    const username = normalizeUsername(userName);
    if (snapshot === null) {
      const result = this.db
        .prepare(
          'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?) ON CONFLICT(username, record_key) DO NOTHING',
        )
        .run(username, key, JSON.stringify(record));
      return result.changes > 0;
    }
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
    filter?: 'updated' | 'shelved',
  ): Promise<PlayRecordPage> {
    const username = normalizeUsername(userName);
    if (filter === 'shelved') {
      const where = buildShelvedPlayRecordWhere(SQLITE_TRACKING_DIALECT);
      const cutoff = Date.now() - SHELVED_PLAY_RECORD_AGE_MS;
      const saveTime = SQLITE_TRACKING_DIALECT.jsonTimestamp('save_time');
      const hasCursor = cursorTime !== undefined && !!cursorKey;
      const rows = this.db
        .prepare(
          `SELECT record_key, record_json FROM play_records
        WHERE username = ? AND ${where}${hasCursor ? ` AND (${saveTime} < ? OR (${saveTime} = ? AND record_key < ?))` : ''}
        ORDER BY ${saveTime} DESC, record_key DESC LIMIT ?`,
        )
        .all(
          ...(hasCursor
            ? [username, cutoff, cursorTime, cursorTime, cursorKey, limit + 1]
            : [username, cutoff, limit + 1]),
        ) as { record_key: string; record_json: string }[];
      const count = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM play_records WHERE username = ? AND ${where}`,
        )
        .get(username, cutoff) as { count: number };
      return buildPlayRecordPage(rows, count.count, limit);
    }
    const pageStatement =
      filter === 'updated'
        ? this.stmts.getUpdatedPlayRecordPage
        : this.stmts.getPlayRecordPage;
    const afterStatement =
      filter === 'updated'
        ? this.stmts.getUpdatedPlayRecordPageAfter
        : this.stmts.getPlayRecordPageAfter;
    const countStatement =
      filter === 'updated'
        ? this.stmts.countUnreadTrackingPlayRecords
        : this.stmts.countPlayRecords;
    const rows = (
      cursorTime !== undefined && cursorKey
        ? afterStatement.all(
            username,
            cursorTime,
            cursorTime,
            cursorKey,
            limit + 1,
          )
        : pageStatement.all(username, limit + 1)
    ) as { record_key: string; record_json: string }[];
    const countRow = countStatement.get(username) as {
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

  async deletePlayRecords(userName: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const uniqueKeys = [...new Set(keys)];
    this.db
      .prepare(
        `DELETE FROM play_records WHERE username = ? AND record_key IN (${uniqueKeys.map(() => '?').join(', ')})`,
      )
      .run(normalizeUsername(userName), ...uniqueKeys);
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    const username = normalizeUsername(userName);
    this.stmts.deletePlayRecordsByUser.run(username);
  }

  async getFavoriteUpdateMessagePage(
    userName: string,
    limit: number,
    before?: import('@/lib/message-cursor.server').MessageCursor | null,
  ) {
    const username = normalizeUsername(userName);
    const sql = favoriteMessageQueries('sqlite', username, limit, before);
    const rows = this.db.prepare(sql.page).all(...sql.params) as {
      favorite_key: string;
      favorite_json: string;
    }[];
    const count = this.db.prepare(sql.count).get(username) as { count: number };
    return { items: favoriteMessagesFromRows(rows), total: count.count };
  }

  async readFavoriteUpdate(
    userName: string,
    key: string,
    episodes: number,
  ): Promise<void> {
    this.db
      .prepare(favoriteReadStatement('sqlite'))
      .run(episodes, normalizeUsername(userName), key, episodes, episodes);
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

  async setFavoriteTracking(
    userName: string,
    key: string,
    trackingEnabled: boolean,
  ): Promise<Favorite | null> {
    const row = this.db
      .prepare(`${favoriteTrackingStatement('sqlite')} RETURNING favorite_json`)
      .get(
        JSON.stringify(trackingEnabled),
        normalizeUsername(userName),
        key,
      ) as { favorite_json: string } | undefined;
    return parseJsonValue<Favorite>(row?.favorite_json);
  }

  async saveMergedFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<string> {
    const username = normalizeUsername(userName);
    return this.db
      .transaction(() => {
        const sql = mergeSelection(username, key, favorite);
        const rows = this.db.prepare(sql.sql).all(...sql.params) as {
          favorite_key: string;
          favorite_json: string;
        }[];
        const merged = mergeFavorite(key, favorite, rows);
        const json = JSON.stringify(merged.favorite);
        this.stmts.setFavorite.run(
          username,
          merged.key,
          json,
          ...favoriteProjection(merged.key, json),
        );
        for (const remove of merged.removeKeys)
          this.stmts.deleteFavorite.run(username, remove);
        return merged.key;
      })
      .immediate();
  }

  async batchFavorites(
    userName: string,
    input: FavoriteBatchInput,
  ): Promise<{ affected: number }> {
    const username = normalizeUsername(userName);
    const sql = batchSelection('sqlite', username, input);
    return this.db
      .transaction(() => {
        const rows = this.db
          .prepare(sql.sql)
          .all(...sql.params) as LibraryRow[];
        const now = Date.now();
        for (const row of rows) {
          if (input.action === 'remove')
            this.stmts.deleteFavorite.run(username, row.favorite_key);
          else {
            const json = JSON.stringify(
              applyFavoriteStatus(JSON.parse(row.favorite_json), input, now),
            );
            this.stmts.setFavorite.run(
              username,
              row.favorite_key,
              json,
              ...favoriteProjection(row.favorite_key, json),
            );
          }
        }
        return { affected: rows.length };
      })
      .immediate();
  }

  async getFavoriteForWork(userName: string, work: FavoriteWorkQuery) {
    const sql = workSelection('sqlite', normalizeUsername(userName), work);
    const row = this.db.prepare(sql.sql).get(...sql.params) as
      | LibraryRow
      | undefined;
    return row ? libraryItem(row) : null;
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

  private runListPlan<T>(plan: ListPlan<T>): T {
    return this.db
      .transaction(() => {
        let step = plan.next();
        while (!step.done) {
          const { sql, params } = step.value;
          const query = this.db.prepare(sql);
          const rows = query.reader
            ? (query.all(...params) as ListRow[])
            : (query.run(...params), []);
          step = plan.next(rows);
        }
        return step.value;
      })
      .immediate();
  }
  async getAnnualActivity(
    ...args: Parameters<IStorage['getAnnualActivity']>
  ): ReturnType<IStorage['getAnnualActivity']> {
    return this.runListPlan(annualActivityPlan('sqlite', ...args));
  }

  async countCapsules(
    ...args: Parameters<IStorage['countCapsules']>
  ): ReturnType<IStorage['countCapsules']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').countCapsules(...args),
    );
  }
  async getCompletion(
    ...args: Parameters<IStorage['getCompletion']>
  ): ReturnType<IStorage['getCompletion']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').getCompletion(...args),
    );
  }
  async createCapsule(
    ...args: Parameters<IStorage['createCapsule']>
  ): ReturnType<IStorage['createCapsule']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').createCapsule(...args),
    );
  }
  async getCapsules(
    ...args: Parameters<IStorage['getCapsules']>
  ): ReturnType<IStorage['getCapsules']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').getCapsules(...args),
    );
  }
  async deleteCapsule(
    ...args: Parameters<IStorage['deleteCapsule']>
  ): ReturnType<IStorage['deleteCapsule']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').deleteCapsule(...args),
    );
  }
  async openCapsule(
    ...args: Parameters<IStorage['openCapsule']>
  ): ReturnType<IStorage['openCapsule']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').openCapsule(...args),
    );
  }
  async getCapsuleMessages(
    ...args: Parameters<IStorage['getCapsuleMessages']>
  ): ReturnType<IStorage['getCapsuleMessages']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').getCapsuleMessages(...args),
    );
  }
  async readAllCapsules(
    ...args: Parameters<IStorage['readAllCapsules']>
  ): ReturnType<IStorage['readAllCapsules']> {
    return this.runListPlan(
      new ViewingHappinessPlans('sqlite').readAllCapsules(...args),
    );
  }
  async getTrackingCalendarItems(
    userName: string,
  ): ReturnType<IStorage['getTrackingCalendarItems']> {
    const username = normalizeUsername(userName);
    const rows = this.db
      .prepare(trackingCalendarSql('sqlite'))
      .all(username, username) as TrackingCalendarRow[];
    return trackingCalendarItems(rows as TrackingCalendarRow[]);
  }

  async countPlazaLists(
    ...args: Parameters<IStorage['countPlazaLists']>
  ): ReturnType<IStorage['countPlazaLists']> {
    return this.runListPlan(new ListPlans('sqlite').countPlazaLists(...args));
  }
  async getListItemCount(
    ...args: Parameters<IStorage['getListItemCount']>
  ): ReturnType<IStorage['getListItemCount']> {
    return this.runListPlan(new ListPlans('sqlite').getListItemCount(...args));
  }
  async setListLike(
    ...args: Parameters<IStorage['setListLike']>
  ): ReturnType<IStorage['setListLike']> {
    return this.runListPlan(new ListPlans('sqlite').setListLike(...args));
  }
  async recordListView(
    ...args: Parameters<IStorage['recordListView']>
  ): ReturnType<IStorage['recordListView']> {
    return this.runListPlan(new ListPlans('sqlite').recordListView(...args));
  }
  async getPlazaLists(
    ...args: Parameters<IStorage['getPlazaLists']>
  ): ReturnType<IStorage['getPlazaLists']> {
    return this.runListPlan(new ListPlans('sqlite').getPlazaLists(...args));
  }
  async getLists(
    ...args: Parameters<IStorage['getLists']>
  ): ReturnType<IStorage['getLists']> {
    return this.runListPlan(new ListPlans('sqlite').getLists(...args));
  }
  async countUserLists(
    ...args: Parameters<IStorage['countUserLists']>
  ): ReturnType<IStorage['countUserLists']> {
    return this.runListPlan(new ListPlans('sqlite').countUserLists(...args));
  }
  async getList(
    ...args: Parameters<IStorage['getList']>
  ): ReturnType<IStorage['getList']> {
    return this.runListPlan(new ListPlans('sqlite').getList(...args));
  }
  async createList(
    ...args: Parameters<IStorage['createList']>
  ): ReturnType<IStorage['createList']> {
    return this.runListPlan(new ListPlans('sqlite').createList(...args));
  }
  async updateList(
    ...args: Parameters<IStorage['updateList']>
  ): ReturnType<IStorage['updateList']> {
    return this.runListPlan(new ListPlans('sqlite').updateList(...args));
  }
  async deleteList(
    ...args: Parameters<IStorage['deleteList']>
  ): ReturnType<IStorage['deleteList']> {
    return this.runListPlan(new ListPlans('sqlite').deleteList(...args));
  }
  async addListItem(
    ...args: Parameters<IStorage['addListItem']>
  ): ReturnType<IStorage['addListItem']> {
    return this.runListPlan(new ListPlans('sqlite').addListItem(...args));
  }
  async removeListItem(
    ...args: Parameters<IStorage['removeListItem']>
  ): ReturnType<IStorage['removeListItem']> {
    return this.runListPlan(new ListPlans('sqlite').removeListItem(...args));
  }
  async reorderListItems(
    ...args: Parameters<IStorage['reorderListItems']>
  ): ReturnType<IStorage['reorderListItems']> {
    return this.runListPlan(new ListPlans('sqlite').reorderListItems(...args));
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

  async getAnnualRecap(
    ...args: Parameters<IStorage['getAnnualRecap']>
  ): ReturnType<IStorage['getAnnualRecap']> {
    return this.social.getAnnualRecap(...args);
  }
  async getAnnualRecapYears(
    ...args: Parameters<IStorage['getAnnualRecapYears']>
  ): ReturnType<IStorage['getAnnualRecapYears']> {
    return this.social.getAnnualRecapYears(...args);
  }
  async saveAnnualRecap(
    ...args: Parameters<IStorage['saveAnnualRecap']>
  ): ReturnType<IStorage['saveAnnualRecap']> {
    return this.social.saveAnnualRecap(...args);
  }
  async deleteAnnualRecap(
    ...args: Parameters<IStorage['deleteAnnualRecap']>
  ): ReturnType<IStorage['deleteAnnualRecap']> {
    return this.social.deleteAnnualRecap(...args);
  }
  async getFollowRecapMessages(
    ...args: Parameters<IStorage['getFollowRecapMessages']>
  ): ReturnType<IStorage['getFollowRecapMessages']> {
    return this.social.getFollowRecapMessages(...args);
  }
  async getFollowRecapMessageCount(
    ...args: Parameters<IStorage['getFollowRecapMessageCount']>
  ): ReturnType<IStorage['getFollowRecapMessageCount']> {
    return this.social.getFollowRecapMessageCount(...args);
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

  private runNoticeMutation(mutation: NoticeMutation): number {
    return this.db
      .transaction(() => {
        let step = mutation.next();
        while (!step.done) {
          const statement = step.value;
          const rows = statement.read
            ? (this.db
                .prepare(statement.sql)
                .all(...statement.params) as Record<string, unknown>[])
            : (this.db.prepare(statement.sql).run(...statement.params), []);
          step = mutation.next(rows);
        }
        return step.value;
      })
      .immediate();
  }

  private get notices() {
    return new UserNoticeStorage({
      dialect: 'sqlite' as const,
      rows: async <T>(sql: string, params: unknown[] = []) =>
        this.db.prepare(sql).all(...params) as T[],
      run: async (sql: string, params: unknown[] = []) =>
        this.db.prepare(sql).run(...params).changes,
    });
  }
  async getUserNoticeMessages(
    ...args: Parameters<IStorage['getUserNoticeMessages']>
  ) {
    return this.notices.messages(...args);
  }
  async getUserNoticeCount(
    ...args: Parameters<IStorage['getUserNoticeCount']>
  ) {
    return this.notices.count(...args);
  }
  async purgeUserNotices(before: number): Promise<number> {
    return this.db
      .prepare('DELETE FROM user_notice_events WHERE created_at <= ?')
      .run(before).changes;
  }

  async deleteReviewReply(
    id: string,
    username: string,
    admin = false,
  ): Promise<boolean> {
    return (
      (await this.runNoticeMutation(
        new NoticeModeration('sqlite').reply(id, username, admin),
      )) > 0
    );
  }
  async moderateReplyReports(
    id: string,
    action: 'dismiss' | 'delete-reply',
  ): Promise<void> {
    await this.runNoticeMutation(
      new NoticeModeration('sqlite').reply(id, '', true, action),
    );
  }

  async getReviewReplies(
    ...args: Parameters<IStorage['getReviewReplies']>
  ): ReturnType<IStorage['getReviewReplies']> {
    return this.social.getReviewReplies(...args);
  }

  async postReviewReply(
    ...args: Parameters<IStorage['postReviewReply']>
  ): ReturnType<IStorage['postReviewReply']> {
    return this.social.postReviewReply(...args);
  }

  async reportReviewReply(
    ...args: Parameters<IStorage['reportReviewReply']>
  ): ReturnType<IStorage['reportReviewReply']> {
    return this.social.reportReviewReply(...args);
  }

  async getReviewReplyMessages(
    ...args: Parameters<IStorage['getReviewReplyMessages']>
  ): ReturnType<IStorage['getReviewReplyMessages']> {
    return this.social.getReviewReplyMessages(...args);
  }

  async getReviewReplyMessageCount(
    ...args: Parameters<IStorage['getReviewReplyMessageCount']>
  ): ReturnType<IStorage['getReviewReplyMessageCount']> {
    return this.social.getReviewReplyMessageCount(...args);
  }

  async getPublicReview(
    ...args: Parameters<IStorage['getPublicReview']>
  ): ReturnType<IStorage['getPublicReview']> {
    return this.social.getPublicReview(...args);
  }

  async getSocialNotifications(
    ...args: Parameters<IStorage['getSocialNotifications']>
  ): ReturnType<IStorage['getSocialNotifications']> {
    return this.social.getSocialNotifications(...args);
  }

  async getSocialNotificationCount(
    ...args: Parameters<IStorage['getSocialNotificationCount']>
  ): ReturnType<IStorage['getSocialNotificationCount']> {
    return this.social.getSocialNotificationCount(...args);
  }

  async getUserSocialData(
    ...args: Parameters<IStorage['getUserSocialData']>
  ): ReturnType<IStorage['getUserSocialData']> {
    return this.social.getUserSocialData(...args);
  }

  async addUserDanmaku(item: StoredUserDanmaku): Promise<void> {
    this.db.prepare(USER_DANMAKU_INSERT).run(...userDanmakuValues(item));
  }
  async getUserDanmaku(
    episodeKey: string,
    limit: number,
  ): Promise<StoredUserDanmaku[]> {
    return (
      this.db
        .prepare(
          `SELECT ${USER_DANMAKU_PROJECTION} FROM user_danmaku WHERE episode_key = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(episodeKey, limit) as StoredUserDanmaku[]
    ).map(storedUserDanmaku);
  }
  async getAllUserDanmaku(username: string): Promise<StoredUserDanmaku[]> {
    return (
      this.db
        .prepare(
          `SELECT ${USER_DANMAKU_PROJECTION} FROM user_danmaku WHERE username = ? ORDER BY created_at DESC, id DESC`,
        )
        .all(normalizeUsername(username)) as StoredUserDanmaku[]
    ).map(storedUserDanmaku);
  }
  async deleteUserDanmaku(id: string, username?: string): Promise<boolean> {
    return (
      this.db
        .prepare(
          `DELETE FROM user_danmaku WHERE id = ?${username === undefined ? '' : ' AND username = ?'}`,
        )
        .run(
          ...(username === undefined
            ? [id]
            : [id, normalizeUsername(username)]),
        ).changes > 0
    );
  }
  async getUserDanmakuPage(
    query: Parameters<IStorage['getUserDanmakuPage']>[0],
  ): Promise<StoredUserDanmaku[]> {
    const { sql, params } = userDanmakuPageSql(query);
    return (this.db.prepare(sql).all(...params) as StoredUserDanmaku[]).map(
      storedUserDanmaku,
    );
  }
  async deleteUserDanmakuBatch(ids: string[]): Promise<number> {
    return this.runNoticeMutation(new NoticeModeration('sqlite').danmaku(ids));
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
      review.is_public ? review.updated_at : null,
    );
  }

  async deleteVideoReview(
    userName: string,
    titleNorm: string,
    year: string,
    publicOnly = false,
  ): Promise<void> {
    await this.runNoticeMutation(
      new NoticeModeration('sqlite').review(
        userName,
        titleNorm,
        year,
        'delete-review',
        publicOnly,
      ),
    );
  }
  async moderateReviewReports(
    author: string,
    title: string,
    year: string,
    action: 'dismiss' | 'mark-spoiler' | 'delete-review',
  ): Promise<void> {
    await this.runNoticeMutation(
      new NoticeModeration('sqlite').review(author, title, year, action, true),
    );
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
  async getWorkWatchStatuses(
    ...args: Parameters<IStorage['getWorkWatchStatuses']>
  ): ReturnType<IStorage['getWorkWatchStatuses']> {
    return this.social.getWorkWatchStatuses(...args);
  }

  async getFollowOpinions(
    ...args: Parameters<IStorage['getFollowOpinions']>
  ): ReturnType<IStorage['getFollowOpinions']> {
    return this.social.getFollowOpinions(...args);
  }

  async getTasteMatch(
    ...args: Parameters<IStorage['getTasteMatch']>
  ): ReturnType<IStorage['getTasteMatch']> {
    return this.social.getTasteMatch(...args);
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

  async getOAuthIdentity(id: string) {
    return readOAuthIdentity(
      this.db
        .prepare(
          "SELECT * FROM oauth_identities WHERE provider = 'linuxdo' AND provider_user_id = ?",
        )
        .get(id) as Record<string, unknown> | undefined,
    );
  }
  async getUserOAuthIdentity(username: string) {
    return readOAuthIdentity(
      this.db
        .prepare(
          "SELECT * FROM oauth_identities WHERE provider = 'linuxdo' AND username = ?",
        )
        .get(normalizeUsername(username)) as
        | Record<string, unknown>
        | undefined,
    );
  }
  async bindOAuthIdentity(identity: OAuthIdentity): Promise<OAuthBindResult> {
    const username = normalizeUsername(identity.username);
    return this.db.transaction(() => {
      if (!this.stmts.checkUserExist.get(username)) return 'user_missing';
      const existing = readOAuthIdentity(
        this.db
          .prepare(
            "SELECT * FROM oauth_identities WHERE provider = 'linuxdo' AND provider_user_id = ?",
          )
          .get(identity.providerUserId) as Record<string, unknown> | undefined,
      );
      if (existing)
        return existing.username === username ? 'bound' : 'identity_taken';
      if (
        this.db
          .prepare(
            "SELECT 1 FROM oauth_identities WHERE provider = 'linuxdo' AND username = ?",
          )
          .get(username)
      )
        return 'user_bound';
      this.db
        .prepare(OAUTH_INSERT)
        .run(
          ...oauthIdentityParams({ ...identity, username, autoCreated: false }),
        );
      return 'bound';
    })();
  }
  async unbindOAuthIdentity(username: string): Promise<boolean> {
    return (
      this.db
        .prepare(
          "DELETE FROM oauth_identities WHERE provider = 'linuxdo' AND username = ? AND auto_created = 0",
        )
        .run(normalizeUsername(username)).changes > 0
    );
  }
  async updateOAuthProviderUsername(id: string, name: string): Promise<void> {
    this.db
      .prepare(
        "UPDATE oauth_identities SET provider_username = ? WHERE provider = 'linuxdo' AND provider_user_id = ?",
      )
      .run(name, id);
  }

  async registerUser(
    userName: string,
    password: string,
    nickname?: string,
    userGroups?: string[],
    identity?: import('@/lib/oauth-identity').OAuthIdentity,
    inviteCode?: string,
  ): Promise<void> {
    const username = assertValidUsernameFormat(userName);
    if (this.stmts.checkUserExist.get(username)) {
      throw new Error('用户已存在');
    }
    const hashed = await hashPassword(password);
    try {
      this.registerUserWithActivity(
        username,
        hashed,
        Date.now(),
        nickname,
        userGroups,
        identity,
        inviteCode,
      );
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
    userGroups?: string[],
    identity?: OAuthIdentity,
    inviteCode?: string,
  ): void {
    this.db.transaction(() => {
      // 第三方自动建号写入的是随机密码，记为未设密，允许用户免旧密码首次设置
      this.stmts.registerUser.run(username, hashedPassword, identity ? 0 : 1);
      if (identity)
        this.db.prepare(OAUTH_INSERT).run(
          ...oauthIdentityParams({
            ...identity,
            username,
            autoCreated: true,
          }),
        );
      this.stmts.recordUserLogin.run(username, now);
      if (inviteCode)
        this.db
          .prepare(
            'INSERT INTO invite_code_redemptions (username, code, redeemed_at) VALUES (?, ?, ?)',
          )
          .run(username, inviteCode, now);
      this.insertUserProfile(username, nickname);
      new SqliteUserAccessStore(this.db).put({
        username,
        role: 'user',
        tags: userGroups,
      });
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

  async isPasswordSet(userName: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT password_set FROM users WHERE username = ?')
      .get(normalizeUsername(userName)) as { password_set: number } | undefined;
    return Boolean(row?.password_set);
  }

  async changePassword(
    userName: string,
    newPassword: string,
    admin = false,
    currentPassword?: string | null,
  ): Promise<boolean> {
    const username = normalizeUsername(userName);
    const hashed = await hashPassword(newPassword);
    const old = this.db
      .prepare('SELECT password, password_set FROM users WHERE username = ?')
      .get(username) as { password: string; password_set: number } | undefined;
    if (!old) return false;
    if (currentPassword !== undefined) {
      if (
        old.password_set &&
        (!currentPassword ||
          !(await verifyPassword(currentPassword, old.password)).match)
      )
        return false;
    }
    if (admin && (await verifyPassword(newPassword, old.password)).match)
      return true;
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            'UPDATE users SET password = ?, password_set = 1 WHERE username = ? AND password = ?',
          )
          .run(hashed, username, old.password);
        if (!result.changes) throw new Error('密码已变化，请重试');
        if (admin) {
          const event = noticeInsert(
            'sqlite',
            username,
            `password:${old.password}`,
            'account-change',
            'password-changed',
            {},
          );
          this.db.prepare(event.sql).run(...event.params);
        }
      })
      .immediate();
    return true;
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
      this.runListPlan(new ListPlans('sqlite').deleteUserLikes(targetUser));
      this.db
        .prepare(
          'DELETE FROM user_list_items WHERE list_id IN (SELECT id FROM user_lists WHERE username = ?)',
        )
        .run(targetUser);
      this.db
        .prepare('DELETE FROM user_lists WHERE username = ?')
        .run(targetUser);
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
      this.db
        .prepare(
          'DELETE FROM video_review_reply_reports WHERE reporter = ? OR reply_id IN (SELECT id FROM video_review_replies WHERE author = ? OR username = ?)',
        )
        .run(targetUser, targetUser, targetUser);
      this.db
        .prepare(
          'DELETE FROM video_review_replies WHERE author = ? OR username = ?',
        )
        .run(targetUser, targetUser);
      this.db
        .prepare(
          'UPDATE video_review_replies SET reply_to = NULL WHERE reply_to = ?',
        )
        .run(targetUser);
      this.db
        .prepare('DELETE FROM oauth_identities WHERE username = ?')
        .run(targetUser);
      this.stmts.deleteUserRow.run(targetUser);
      this.stmts.deletePlayRecordsByUser.run(targetUser);
      this.stmts.deleteFavoritesByUser.run(targetUser);
      this.stmts.deleteVideoReviewsByUser.run(targetUser);
      this.db
        .prepare('DELETE FROM user_danmaku WHERE username = ?')
        .run(targetUser);
      this.stmts.deleteSearchHistoryByUser.run(targetUser);
      this.stmts.deleteSkipConfigsByUser.run(targetUser);
      this.db
        .prepare('DELETE FROM playback_watch_buckets WHERE username = ?')
        .run(targetUser);
      this.db
        .prepare('DELETE FROM watch_history WHERE username = ?')
        .run(targetUser);
      this.stmts.deletePlaybackSessionsByUser.run(targetUser);
      this.db
        .prepare('DELETE FROM user_notice_events WHERE recipient_username = ?')
        .run(targetUser);
      this.db
        .prepare('DELETE FROM time_capsules WHERE username = ?')
        .run(targetUser);
      this.db
        .prepare('DELETE FROM work_completions WHERE username = ?')
        .run(targetUser);
      this.stmts.deleteUserMessageStateByUser.run(targetUser);
      this.db
        .prepare('DELETE FROM user_annual_recaps WHERE username = ?')
        .run(targetUser);
      this.stmts.deleteLoginActivityByUser.run(targetUser);
      this.db
        .prepare('DELETE FROM invite_code_redemptions WHERE username = ?')
        .run(targetUser);
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

  async listAnnouncements(limit: number): Promise<SiteAnnouncement[]> {
    const rows = this.db
      .prepare(ANNOUNCEMENT_LIST_SQL)
      .all(limit) as AnnouncementRow[];
    return rows.map(readAnnouncement);
  }

  async countAnnouncements(): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM announcements')
      .get() as { total: number };
    return row.total;
  }

  async getPublishedAnnouncements(
    options: Parameters<IStorage['getPublishedAnnouncements']>[0],
  ): Promise<SiteAnnouncement[]> {
    const { sql, params } = publishedAnnouncementQuery(options);
    const rows = this.db.prepare(sql).all(...params) as AnnouncementRow[];
    return rows.map(readAnnouncement);
  }

  async getAnnouncement(id: string): Promise<SiteAnnouncement | null> {
    const row = this.db
      .prepare('SELECT * FROM announcements WHERE id = ?')
      .get(id) as AnnouncementRow | undefined;
    return row ? readAnnouncement(row) : null;
  }

  async createAnnouncement(announcement: SiteAnnouncement): Promise<void> {
    this.db
      .prepare(ANNOUNCEMENT_INSERT_SQL)
      .run(
        announcement.id,
        announcement.content,
        announcement.createdAt,
        announcement.updatedAt,
        announcement.publishedAt,
      );
  }

  async updateAnnouncement(
    id: string,
    patch: Parameters<IStorage['updateAnnouncement']>[1],
  ): Promise<SiteAnnouncement | null> {
    const { sql, params } = announcementUpdateQuery(id, patch);
    const row = this.db.prepare(`${sql} RETURNING *`).get(...params) as
      | AnnouncementRow
      | undefined;
    return row ? readAnnouncement(row) : null;
  }

  async deleteAnnouncement(id: string): Promise<boolean> {
    return (
      this.db.prepare('DELETE FROM announcements WHERE id = ?').run(id)
        .changes > 0
    );
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
  async countInviteCodes() {
    return this.invites.count();
  }
  async countActiveInviteCodes() {
    return this.invites.countActive();
  }
  async createInviteCodes(items: InviteCode[]) {
    return this.invites.create(items);
  }
  async createInviteCode(item: InviteCode) {
    return this.createInviteCodes([item]);
  }
  async deleteInviteCode(code: string) {
    return this.invites.delete(code);
  }
  async purgeInviteCodes(options: InviteCodePurge) {
    return this.invites.purge(options);
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
        const noticeAccess = new SqliteUserAccessStore(this.db);
        const noticeUsers = configPermissionsChanged(current, config)
          ? (
              this.db
                .prepare('SELECT username FROM user_access ORDER BY username')
                .all() as { username: string }[]
            ).flatMap((row) => {
              const user = noticeAccess.get(row.username);
              return user
                ? [{ user, key: accessPermissionsKey(user, current) }]
                : [];
            })
          : [];
        const removed = removedAccessReferences(current, config);
        const access = new SqliteUserAccessStore(this.db);
        for (const group of removed.groups) access.removeGroup(group);
        for (const source of removed.sources) access.removeSource(source);
        for (const { user, key } of noticeUsers) {
          const next = noticeAccess.get(user.username);
          if (next && key !== accessPermissionsKey(next, config)) {
            const event = noticeInsert(
              'sqlite',
              user.username,
              `config:${Date.now()}:${JSON.stringify(current)}:${JSON.stringify(config)}`,
              'account-change',
              'permissions-changed',
              {},
            );
            this.db.prepare(event.sql).run(...event.params);
          }
        }
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
    this.db
      .prepare(
        `DELETE FROM shared_cache
         WHERE cache_key = ? AND lease_token = ?
           AND LENGTH(value_text) = 0 AND fresh_until = 0 AND stale_until = 0`,
      )
      .run(key, token);
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

  async saveWatchSessionReport(
    userName: string,
    session: PlaybackSession,
    buckets: PlaybackWatchBucket[],
    history?: WatchHistoryWrite,
  ): Promise<string | null> {
    const username = normalizeUsername(userName);
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare(
            'SELECT username, watch_seconds FROM playback_sessions WHERE id = ?',
          )
          .get(session.id) as
          | { username: string; watch_seconds: number }
          | undefined;
        if (existing && existing.username !== username) return null;
        if (
          !buckets.some((bucket) => bucket.watch_ms > 0) &&
          !this.db
            .prepare(
              'SELECT 1 FROM playback_watch_buckets WHERE username = ? AND session_id = ? AND watch_ms > 0 LIMIT 1',
            )
            .get(username, session.id)
        )
          return null;
        this.db
          .prepare(
            `INSERT INTO playback_sessions (
        id, username, source, video_id, episode_index, title, source_name, cover, year,
        started_at, ended_at, watch_seconds, last_position, total_time, created_at, updated_at, measurement_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 2)
      ON CONFLICT(id) DO UPDATE SET ended_at = MAX(ended_at, excluded.ended_at),
        last_position = excluded.last_position, total_time = excluded.total_time,
        title = excluded.title, source_name = excluded.source_name, cover = excluded.cover, year = excluded.year,
        updated_at = MAX(updated_at, excluded.updated_at), measurement_version = 2
      WHERE playback_sessions.username = excluded.username`,
          )
          .run(
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
            session.last_position,
            session.total_time,
            session.created_at,
            session.updated_at,
          );
        const putBucket = this.db
          .prepare(`INSERT INTO playback_watch_buckets (username, session_id, bucket_start, watch_ms)
        VALUES (?, ?, ?, ?) ON CONFLICT(username, session_id, bucket_start) DO UPDATE SET watch_ms = MAX(watch_ms, excluded.watch_ms)`);
        for (const bucket of buckets)
          putBucket.run(username, session.id, bucket.start, bucket.watch_ms);
        const total = this.db
          .prepare(
            'SELECT COALESCE(SUM(watch_ms), 0) AS total FROM playback_watch_buckets WHERE username = ? AND session_id = ?',
          )
          .get(username, session.id) as { total: number };
        this.db
          .prepare(
            'UPDATE playback_sessions SET watch_seconds = ?, measurement_version = 2 WHERE id = ? AND username = ?',
          )
          .run(Math.floor(total.total / 1000), session.id, username);
        if (!history || total.total <= 0) return null;
        const values = [
          session.title,
          session.source_name,
          session.cover,
          session.year,
          session.episode_index,
          history.total_episodes,
          history.group_label ?? null,
          history.group_index ?? null,
          history.group_total ?? null,
          session.last_position,
          session.total_time,
          session.updated_at,
        ];
        if (history.id) {
          const result = this.db
            .prepare(
              `UPDATE watch_history SET title = ?, source_name = ?, cover = ?, year = ?,
          episode_index = ?, total_episodes = ?, group_label = ?, group_index = ?, group_total = ?,
          position = ?, duration = ?, last_watched_at = ? WHERE username = ? AND id = ? AND source = ? AND video_id = ?`,
            )
            .run(
              ...values,
              username,
              history.id,
              session.source,
              session.video_id,
            );
          return result.changes ? history.id : null;
        }
        this.db
          .prepare(
            `INSERT INTO watch_history (
        title, source_name, cover, year, episode_index, total_episodes, group_label, group_index, group_total,
        position, duration, last_watched_at, username, id, source, video_id, first_watched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username, source, video_id) DO UPDATE SET
        title = excluded.title, source_name = excluded.source_name, cover = excluded.cover, year = excluded.year,
        episode_index = excluded.episode_index, total_episodes = excluded.total_episodes, group_label = excluded.group_label,
        group_index = excluded.group_index, group_total = excluded.group_total, position = excluded.position,
        duration = excluded.duration, last_watched_at = excluded.last_watched_at`,
          )
          .run(
            ...values,
            username,
            randomUUID(),
            session.source,
            session.video_id,
            session.started_at,
          );
        return (
          this.db
            .prepare(
              'SELECT id FROM watch_history WHERE username = ? AND source = ? AND video_id = ?',
            )
            .get(username, session.source, session.video_id) as { id: string }
        ).id;
      })
      .immediate();
  }

  async getWatchHistoryPage(
    userName: string,
    query: WatchHistoryQuery,
  ): Promise<WatchHistoryEntry[]> {
    const conditions = ['username = ?'];
    const params: (string | number)[] = [normalizeUsername(userName)];
    if (query.cursor) {
      conditions.push(
        '(last_watched_at < ? OR (last_watched_at = ? AND id < ?))',
      );
      params.push(
        query.cursor.lastWatchedAt,
        query.cursor.lastWatchedAt,
        query.cursor.id,
      );
    }
    const keyword = normalizePlaybackSearchKeyword(query.keyword);
    if (keyword) {
      conditions.push("title LIKE ? ESCAPE '!'");
      params.push(buildPlaybackSearchLikePattern(keyword));
    }
    params.push(query.limit);
    const rows = this.db
      .prepare(
        `SELECT id, source, video_id, title, source_name, cover, year, episode_index,
      total_episodes, group_label, group_index, group_total, position, duration, first_watched_at, last_watched_at
      FROM watch_history WHERE ${conditions.join(' AND ')} ORDER BY last_watched_at DESC, id DESC LIMIT ?`,
      )
      .all(...params) as WatchHistoryEntry[];
    return rows.map((row) => ({
      ...row,
      group_label: row.group_label ?? undefined,
      group_index: row.group_index ?? undefined,
      group_total: row.group_total ?? undefined,
    }));
  }

  async deleteWatchHistoryEntry(userName: string, id: string): Promise<void> {
    this.db
      .prepare('DELETE FROM watch_history WHERE username = ? AND id = ?')
      .run(normalizeUsername(userName), id);
  }

  async deletePlaybackSessionsBefore(updatedBefore: number): Promise<number> {
    const cutoff = Number.isFinite(updatedBefore)
      ? Math.max(0, Math.floor(updatedBefore))
      : 0;
    return this.db
      .transaction(() => {
        this.db
          .prepare(
            `DELETE FROM playback_watch_buckets WHERE session_id IN
        (SELECT id FROM playback_sessions WHERE updated_at < ?)`,
          )
          .run(cutoff);
        return Number(
          this.stmts.deletePlaybackSessionsBefore.run(cutoff).changes,
        );
      })
      .immediate();
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

  async getPlaybackSourceUsage(
    start: number,
    end: number,
    userName?: string,
  ): Promise<PlaybackSourceUsage[]> {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [];
    const personal = userName !== undefined;
    const params = personal
      ? [normalizeUsername(userName), start, end]
      : [start, end];
    const rows = this.db
      .prepare(sourceUsageSql(personal))
      .all(...params) as PlaybackSourceUsageRow[];
    return aggregateSourceUsage(rows);
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
        `SELECT source, video_id, episode_index, title, cover, year, started_at, ended_at, watch_seconds
        FROM playback_sessions
        WHERE username = ? AND started_at >= ? AND started_at < ? AND watch_seconds > 0`,
      )
      .all(username, start, end) as PlaybackPeriodSession[];
  }

  async hasPlaybackAnnualActivity(
    userName: string,
    start: number,
    end: number,
  ): Promise<boolean> {
    const row = this.db
      .prepare(ANNUAL_MESSAGE_EXISTS_SQL)
      .get(normalizeUsername(userName), start, end);
    return !!row;
  }

  async getPlaybackAnnualData(
    userName: string,
    start: number,
    end: number,
  ): Promise<PlaybackAnnualData> {
    const username = normalizeUsername(userName);
    const earliest = this.db.prepare(ANNUAL_EARLIEST_SQL).get(username) as
      | { started_at: number }
      | undefined;
    const earliestStartedAt = earliest?.started_at ?? null;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return { sessions: [], buckets: [], earliestStartedAt };
    const sessions = this.db
      .prepare(ANNUAL_SESSIONS_SQL)
      .all(
        username,
        end,
        start,
        username,
        start,
        end,
        username,
      ) as PlaybackAnnualData['sessions'];
    const buckets = this.db
      .prepare(ANNUAL_BUCKETS_SQL)
      .all(username, start, end) as PlaybackAnnualData['buckets'];
    return { sessions, buckets, earliestStartedAt };
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
    const routeMode = SOURCE_ROUTE_STAT_STORAGE_MODES[input.routeMode];
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
        (row) =>
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.browser ||
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.server,
      )
      .map((row) => ({
        source: row.source,
        routeMode:
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.server
            ? 'server'
            : 'browser',
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }

  async purgeSourceRouteStatsBefore(beforeDate: string): Promise<void> {
    this.db
      .prepare('DELETE FROM source_route_stats WHERE bucket_date < ?')
      .run(beforeDate);
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
        (row) =>
          row.route_mode === 'browser' ||
          row.route_mode === 'server' ||
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.browser ||
          row.route_mode === SOURCE_ROUTE_STAT_STORAGE_MODES.server,
      )
      .map((row) => ({
        source: row.source,
        routeMode: row.route_mode as SourceRouteStatsBucket['routeMode'],
        bucketDate: row.bucket_date,
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
      }));
  }
}
