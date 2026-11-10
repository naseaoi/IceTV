/** @jest-environment node */
import {
  assertBatchDeletePlayRecords,
  assertUpdatedPlayRecordPage,
} from '@/lib/__tests__/__fixtures__/play-record-page-contract';
import { assertPlaybackPeriodRange } from '@/lib/__tests__/__fixtures__/playback-period-contract';
import { assertWatchHistoryContract } from '@/lib/__tests__/__fixtures__/watch-history-contract';
import type { AnnouncementRow } from '@/lib/announcement-storage';
import { hasPlayRecordUpdate } from '@/lib/play-records';
import type { StoredUserDanmaku } from '@/lib/user-danmaku-storage';
import type { AdminConfig } from '@/types/admin';

import { announcementContract } from './__fixtures__/announcement-contract';
import { oauthIdentityContract } from './__fixtures__/oauth-identity-contract';
import { executeSocial, querySocial } from './__fixtures__/social-fake-sql';
import { userDanmakuContract } from './__fixtures__/user-danmaku-contract';
import { videoReviewContract } from './__fixtures__/video-review-contract';

type SearchHistoryRow = {
  username: string;
  keyword: string;
  sortIndex: number;
};

type SourceRouteStatsRow = {
  source: string;
  routeMode: 'browser' | 'server' | 'browser-v2' | 'server-v2';
  bucketDate: string;
  successCount: number;
  failureCount: number;
  updatedAt: number;
};

type HealthSearchRow = {
  source: string;
  bucketDate: string;
  okCount: number;
  emptyCount: number;
  errorCount: number;
  latencyMsSum: number;
  latencySamples: number;
};

type HealthPlayRow = {
  source: string;
  bucketDate: string;
  reporter: string;
  successCount: number;
  failureCount: number;
};

type FakeState = {
  announcements: Map<string, AnnouncementRow>;
  healthSearch: HealthSearchRow[];
  healthPlay: HealthPlayRow[];
  subscription: Record<string, unknown> | null;
  liveCounts: Map<string, Record<string, unknown>>;
  social: Record<string, Record<string, any>[]>;
  userAccess: Map<string, Record<string, any>>;
  userGroups: Record<string, any>[];
  users: Map<string, string>;
  playRecords: Map<string, Map<string, string>>;
  favorites: Map<string, Map<string, string>>;
  videoReviews: Map<string, { username: string; review: VideoReview }>;
  userDanmaku: Map<string, StoredUserDanmaku>;
  skipConfigs: Map<string, Map<string, string>>;
  playbackSessions: Map<string, Record<string, unknown>>;
  watchHistory: Record<string, any>[];
  watchBuckets: Record<string, any>[];
  historyMigrated: boolean;
  searchHistory: SearchHistoryRow[];
  sourceRouteStats: SourceRouteStatsRow[];
  adminConfig: string | null;
  messageStates: Map<string, string>;
  loginActivities: Map<string, number>;
  inviteCodeUsage: Map<string, number>;
  inviteCodes: Map<string, Record<string, any>>;
  danmakuEpisodes: Map<string, Map<string, number>>;
  danmakuEnabled: Map<string, boolean>;
};

function cloneNestedMap(source: Map<string, Map<string, string>>) {
  return new Map(
    Array.from(source.entries(), ([key, value]) => [key, new Map(value)]),
  );
}

function cloneState(state: FakeState): FakeState {
  return {
    announcements: new Map(
      [...state.announcements].map(([id, row]) => [id, { ...row }]),
    ),
    healthSearch: state.healthSearch.map((row) => ({ ...row })),
    healthPlay: state.healthPlay.map((row) => ({ ...row })),
    subscription: state.subscription ? { ...state.subscription } : null,
    liveCounts: new Map(
      [...state.liveCounts].map(([key, row]) => [key, { ...row }]),
    ),
    social: Object.fromEntries(
      Object.entries(state.social).map(([key, rows]) => [
        key,
        rows.map((row) => ({ ...row })),
      ]),
    ),
    userAccess: new Map(
      [...state.userAccess].map(([key, row]) => [key, { ...row }]),
    ),
    userGroups: state.userGroups.map((row) => ({ ...row })),
    users: new Map(state.users),
    playRecords: cloneNestedMap(state.playRecords),
    favorites: cloneNestedMap(state.favorites),
    videoReviews: new Map(state.videoReviews),
    userDanmaku: new Map(state.userDanmaku),
    skipConfigs: cloneNestedMap(state.skipConfigs),
    playbackSessions: new Map(
      [...state.playbackSessions].map(([id, row]) => [id, { ...row }]),
    ),
    watchHistory: state.watchHistory.map((row) => ({ ...row })),
    watchBuckets: state.watchBuckets.map((row) => ({ ...row })),
    historyMigrated: state.historyMigrated,
    searchHistory: state.searchHistory.map((row) => ({ ...row })),
    sourceRouteStats: state.sourceRouteStats.map((row) => ({ ...row })),
    adminConfig: state.adminConfig,
    messageStates: new Map(state.messageStates),
    loginActivities: new Map(state.loginActivities),
    inviteCodeUsage: new Map(state.inviteCodeUsage),
    inviteCodes: new Map(
      [...state.inviteCodes].map(([code, item]) => [code, { ...item }]),
    ),
    danmakuEpisodes: new Map(
      Array.from(state.danmakuEpisodes.entries(), ([key, value]) => [
        key,
        new Map(value),
      ]),
    ),
    danmakuEnabled: new Map(state.danmakuEnabled),
  };
}

function createState(): FakeState {
  return {
    announcements: new Map(),
    healthSearch: [],
    healthPlay: [],
    subscription: null,
    liveCounts: new Map(),
    social: {
      user_profiles: [],
      user_follows: [],
      video_review_likes: [],
      video_review_reports: [],
      video_review_replies: [],
      video_review_reply_reports: [],
    },
    userAccess: new Map(),
    userGroups: [],
    users: new Map(),
    playRecords: new Map(),
    favorites: new Map(),
    videoReviews: new Map(),
    userDanmaku: new Map(),
    skipConfigs: new Map(),
    playbackSessions: new Map(),
    watchHistory: [],
    watchBuckets: [],
    historyMigrated: false,
    searchHistory: [],
    sourceRouteStats: [],
    adminConfig: null,
    messageStates: new Map(),
    loginActivities: new Map(),
    inviteCodeUsage: new Map(),
    inviteCodes: new Map(),
    danmakuEpisodes: new Map(),
    danmakuEnabled: new Map(),
  };
}

function upsertJsonRecord(
  store: Map<string, Map<string, string>>,
  username: string,
  key: string,
  value: string,
) {
  const records = store.get(username) || new Map<string, string>();
  records.set(key, value);
  store.set(username, records);
}

function getJsonRows(
  store: Map<string, Map<string, string>>,
  username: string,
  keyField: string,
  valueField: string,
) {
  return Array.from(store.get(username)?.entries() || []).map(
    ([key, value]) => ({
      [keyField]: key,
      [valueField]: value,
    }),
  );
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

function splitMultiRowInsert(
  sql: string,
  params: unknown[],
): { sql: string; rows: unknown[][] } | null {
  const normalized = normalizeSql(sql);
  const match =
    /^(INSERT INTO .+ VALUES )(\((?:\?, )*\?\))((?:, \((?:\?, )*\?\))+)( ON DUPLICATE KEY UPDATE .+)?$/.exec(
      normalized,
    );
  if (!match) return null;

  const columnsPerRow = match[2].split('?').length - 1;
  const rows: unknown[][] = [];
  for (let offset = 0; offset < params.length; offset += columnsPerRow) {
    rows.push(params.slice(offset, offset + columnsPerRow));
  }
  return { sql: `${match[1]}${match[2]}${match[4] || ''}`, rows };
}

const TRACKING_SQL_MARKER = "'$.tracking_enabled'";
const STALE_METADATA_SQL_MARKER = 'JSON_VALID';

function trackingCreatedAt(record: PlayRecord): number {
  return (
    record.update_detected_at ||
    record.metadata_checked_at ||
    record.save_time ||
    0
  );
}

function isStaleMetadata(value: unknown, now: number, ttlMs: number): boolean {
  const checkedAt =
    value && typeof value === 'object'
      ? (value as { metadata_checked_at?: unknown }).metadata_checked_at
      : undefined;
  return (
    typeof checkedAt !== 'number' ||
    !Number.isFinite(checkedAt) ||
    checkedAt > now ||
    now - checkedAt >= ttlMs
  );
}

function selectStalePlayRecordRows(
  state: FakeState,
  username: string,
  now: number,
  ttlMs: number,
  cursorKey?: string,
) {
  return Array.from(state.playRecords.get(username)?.entries() || [])
    .map(([record_key, record_json]) => ({
      record_key,
      record_json,
      record: JSON.parse(record_json) as PlayRecord,
    }))
    .filter(
      ({ record, record_key }) =>
        isStaleMetadata(record, now, ttlMs) &&
        (cursorKey === undefined || record_key > cursorKey),
    )
    .sort((left, right) => left.record_key.localeCompare(right.record_key))
    .map(({ record_key, record_json }) => ({ record_key, record_json }));
}

function selectStaleFavoriteRows(
  state: FakeState,
  username: string,
  now: number,
  ttlMs: number,
  cursorKey?: string,
) {
  return Array.from(state.favorites.get(username)?.entries() || [])
    .map(([favorite_key, favorite_json]) => ({
      favorite_key,
      favorite_json,
      favorite: JSON.parse(favorite_json) as Favorite,
    }))
    .filter(
      ({ favorite, favorite_key }) =>
        favorite.origin !== 'live' &&
        isStaleMetadata(favorite, now, ttlMs) &&
        (cursorKey === undefined || favorite_key > cursorKey),
    )
    .sort((left, right) => left.favorite_key.localeCompare(right.favorite_key))
    .map(({ favorite_key, favorite_json }) => ({
      favorite_key,
      favorite_json,
    }));
}

function selectUnreadTrackingRows(
  state: FakeState,
  username: string,
  cursorTime?: number,
  cursorKey?: string,
) {
  return Array.from(state.playRecords.get(username)?.entries() || [])
    .map(([key, json]) => ({
      record_key: key,
      record_json: json,
      record: JSON.parse(json) as PlayRecord,
    }))
    .filter(({ record }) => hasPlayRecordUpdate(record))
    .filter(({ record, record_key }) => {
      if (cursorTime === undefined || !cursorKey) return true;
      const createdAt = trackingCreatedAt(record);
      return (
        createdAt < cursorTime ||
        (createdAt === cursorTime && record_key < cursorKey)
      );
    })
    .sort((left, right) => {
      const timeDifference =
        trackingCreatedAt(right.record) - trackingCreatedAt(left.record);
      return timeDifference || right.record_key.localeCompare(left.record_key);
    })
    .map(({ record_key, record_json }) => ({ record_key, record_json }));
}

function createFakePool() {
  let state = createState();
  let transactionQueue = Promise.resolve();
  let queryCount = 0;

  const runExecute = async (
    sql: string,
    params: unknown[] = [],
    currentState: FakeState,
  ) => {
    const multiRow = splitMultiRowInsert(sql, params);
    if (multiRow) {
      for (const rowParams of multiRow.rows) {
        await runSingleExecute(multiRow.sql, rowParams, currentState);
      }
      return [[], []];
    }
    return runSingleExecute(sql, params, currentState);
  };

  const runSingleExecute = async (
    sql: string,
    params: unknown[] = [],
    currentState: FakeState,
  ) => {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith('INSERT IGNORE INTO storage_migrations'))
      return [{ affectedRows: 0 }, []];
    if (normalized.startsWith('UPDATE storage_migrations')) {
      currentState.historyMigrated = true;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('DELETE FROM watch_history WHERE username = ?')) {
      currentState.watchHistory = currentState.watchHistory.filter(
        (row) =>
          row.username !== params[0] ||
          (params.length > 1 && row.id !== params[1]),
      );
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized === 'DELETE FROM playback_watch_buckets WHERE username = ?'
    ) {
      currentState.watchBuckets = currentState.watchBuckets.filter(
        (row) => row.username !== params[0],
      );
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized === 'DELETE FROM playback_watch_buckets WHERE session_id = ?'
    ) {
      currentState.watchBuckets = currentState.watchBuckets.filter(
        (row) => row.session_id !== params[0],
      );
      return [{ affectedRows: 1 }, []];
    }
    if (normalized === 'DELETE FROM playback_sessions WHERE id = ?') {
      currentState.playbackSessions.delete(String(params[0]));
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized.startsWith('INSERT INTO playback_sessions (') &&
      normalized.includes('updated_at, measurement_version)')
    ) {
      const columns = [
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
        'last_position',
        'total_time',
        'created_at',
        'updated_at',
      ];
      const row = Object.fromEntries(
        columns.map((column, i) => [column, params[i]]),
      );
      if (!currentState.playbackSessions.has(String(row.id)))
        currentState.playbackSessions.set(String(row.id), {
          ...row,
          watch_seconds: 0,
          measurement_version: 2,
        });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE playback_sessions SET ended_at')) {
      const row = currentState.playbackSessions.get(String(params[8]));
      if (row && row.username === params[9])
        Object.assign(row, {
          ended_at: Math.max(Number(row.ended_at), Number(params[0])),
          last_position: params[1],
          total_time: params[2],
          title: params[3],
          source_name: params[4],
          cover: params[5],
          year: params[6],
          updated_at: Math.max(Number(row.updated_at), Number(params[7])),
          measurement_version: 2,
        });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO playback_watch_buckets')) {
      const [username, session_id, bucket_start, watch_ms] = params;
      const row = currentState.watchBuckets.find(
        (row) =>
          row.username === username &&
          row.session_id === session_id &&
          row.bucket_start === bucket_start,
      );
      if (row) row.watch_ms = Math.max(row.watch_ms, Number(watch_ms));
      else
        currentState.watchBuckets.push({
          username,
          session_id,
          bucket_start,
          watch_ms,
        });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE playback_sessions SET watch_seconds')) {
      const row = currentState.playbackSessions.get(String(params[1]));
      if (row && row.username === params[2])
        Object.assign(row, {
          watch_seconds: params[0],
          measurement_version: 2,
        });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO watch_history (')) {
      const columns = [
        'title',
        'source_name',
        'cover',
        'year',
        'episode_index',
        'total_episodes',
        'group_label',
        'group_index',
        'group_total',
        'position',
        'duration',
        'last_watched_at',
        'username',
        'id',
        'source',
        'video_id',
        'first_watched_at',
      ];
      const next = Object.fromEntries(
        columns.map((column, i) => [column, params[i]]),
      );
      const row = currentState.watchHistory.find(
        (row) =>
          row.username === next.username &&
          row.source === next.source &&
          row.video_id === next.video_id,
      );
      if (row) {
        const { id, first_watched_at } = row;
        Object.assign(row, next, { id, first_watched_at });
      } else currentState.watchHistory.push(next);
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE watch_history SET title')) {
      const row = currentState.watchHistory.find(
        (row) =>
          row.username === params[12] &&
          row.id === params[13] &&
          row.source === params[14] &&
          row.video_id === params[15],
      );
      if (row)
        [
          'title',
          'source_name',
          'cover',
          'year',
          'episode_index',
          'total_episodes',
          'group_label',
          'group_index',
          'group_total',
          'position',
          'duration',
          'last_watched_at',
        ].forEach((key, i) => (row[key] = params[i]));
      return [{ affectedRows: row ? 1 : 0 }, []];
    }
    if (normalized.startsWith('INSERT INTO announcements ')) {
      const [id, content, created_at, updated_at, published_at] = params as [
        string,
        string,
        number,
        number,
        number | null,
      ];
      if (currentState.announcements.has(id))
        throw new Error('Duplicate announcement');
      currentState.announcements.set(id, {
        id,
        content,
        created_at,
        updated_at,
        published_at,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE announcements SET ')) {
      const row = currentState.announcements.get(
        String(params[params.length - 1]),
      );
      if (!row) return [{ affectedRows: 0 }, []];
      const fields = normalized
        .slice('UPDATE announcements SET '.length)
        .split(' WHERE ')[0]
        .split(', ');
      fields.forEach((field, index) => {
        Object.assign(row, { [field.split(' = ')[0]]: params[index] });
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized === 'DELETE FROM announcements WHERE id = ?') {
      return [
        {
          affectedRows: currentState.announcements.delete(String(params[0]))
            ? 1
            : 0,
        },
        [],
      ];
    }

    if (normalized.startsWith('INSERT INTO user_danmaku (')) {
      const [id, episodeKey, username, timeMs, text, mode, color, createdAt] =
        params;
      if (currentState.userDanmaku.has(String(id)))
        throw new Error('duplicate id');
      currentState.userDanmaku.set(String(id), {
        id,
        episodeKey,
        username,
        timeMs,
        text,
        mode,
        color,
        createdAt,
      } as StoredUserDanmaku);
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized.startsWith('DELETE FROM user_danmaku') &&
      !normalized.includes('user_danmaku_')
    ) {
      let deleted = 0;
      for (const [id, row] of currentState.userDanmaku) {
        const matches = normalized.includes('WHERE id IN')
          ? params.includes(id)
          : normalized.includes('WHERE id =')
            ? id === params[0] &&
              (!normalized.includes('AND username') ||
                row.username === params[1])
            : normalized.includes('WHERE username')
              ? row.username === params[0]
              : true;
        if (matches) {
          currentState.userDanmaku.delete(id);
          deleted++;
        }
      }
      return [{ affectedRows: deleted }, []];
    }

    if (normalized.startsWith('INSERT IGNORE INTO user_access')) {
      for (const username of currentState.users.keys())
        if (!currentState.userAccess.has(username))
          currentState.userAccess.set(username, {
            username,
            role: 'user',
            banned: 0,
            enabled_apis: null,
            updated_at: params[0],
          });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO user_access')) {
      const [username, role, banned, enabled_apis, updated_at] = params;
      currentState.userAccess.set(String(username), {
        username,
        role,
        banned,
        enabled_apis,
        updated_at,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO user_group_members')) {
      const [username, group_name, position] = params;
      currentState.userGroups.push({ username, group_name, position });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized === 'DELETE FROM user_access WHERE username = ?') {
      currentState.userAccess.delete(String(params[0]));
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('DELETE FROM user_group_members')) {
      currentState.userGroups = currentState.userGroups.filter(
        (row) =>
          row[
            normalized.includes('group_name =') ? 'group_name' : 'username'
          ] !== params[0],
      );
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized.startsWith(
        'UPDATE admin_config SET config_json = ? WHERE id = 1 AND CAST(config_json AS CHAR)',
      )
    ) {
      const matches = currentState.adminConfig === params[1];
      if (matches) currentState.adminConfig = String(params[0]);
      return [{ affectedRows: matches ? 1 : 0 }, []];
    }
    if (normalized.startsWith('INSERT INTO oauth_identities')) {
      const rows = (currentState.social.oauth_identities ||= []);
      const [
        provider,
        provider_user_id,
        username,
        provider_username,
        auto_created,
        created_at,
      ] = params;
      if (
        rows.some(
          (row) =>
            row.provider === provider &&
            (row.provider_user_id === provider_user_id ||
              row.username === username),
        )
      )
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      rows.push({
        provider,
        provider_user_id,
        username,
        provider_username,
        auto_created,
        created_at,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('DELETE FROM oauth_identities')) {
      const rows = currentState.social.oauth_identities || [];
      const remaining = rows.filter(
        (row) =>
          row.username !== params[0] ||
          (normalized.includes('auto_created = 0') && row.auto_created !== 0),
      );
      currentState.social.oauth_identities = remaining;
      return [{ affectedRows: rows.length - remaining.length }, []];
    }
    if (
      normalized.startsWith('UPDATE oauth_identities SET provider_username')
    ) {
      const row = currentState.social.oauth_identities?.find(
        (row) => row.provider_user_id === params[1],
      );
      if (row) row.provider_username = params[0];
      return [{ affectedRows: row ? 1 : 0 }, []];
    }
    const socialResult = executeSocial(normalized, params, currentState);
    if (socialResult !== undefined) return [{ affectedRows: socialResult }, []];
    if (
      normalized.startsWith('UPDATE video_reviews SET review_json = JSON_SET')
    ) {
      const row = currentState.videoReviews.get(JSON.stringify(params));
      if (row?.review.is_public) row.review = { ...row.review, spoiler: true };
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (normalized.startsWith('INSERT INTO video_reviews')) {
      const [username, title, year, raw] = params as [
        string,
        string,
        string,
        string,
      ];
      const key = JSON.stringify([username, title, year]);
      const review = JSON.parse(raw) as VideoReview;
      const existing = currentState.videoReviews.get(key);
      if (existing) review.created_at = existing.review.created_at;
      currentState.videoReviews.set(key, { username, review });
      return [[], []];
    }
    if (normalized.startsWith('DELETE FROM video_reviews')) {
      let affectedRows = 0;
      for (const [key, row] of currentState.videoReviews) {
        if (
          row.username === params[0] &&
          (params.length === 1 ||
            (row.review.title_norm === params[1] &&
              row.review.year === params[2] &&
              (!params[3] || row.review.is_public)))
        ) {
          currentState.videoReviews.delete(key);
          affectedRows++;
        }
      }
      return [{ affectedRows }, []];
    }

    if (normalized.startsWith('CREATE TABLE IF NOT EXISTS')) {
      return [[], []];
    }

    if (normalized === 'INSERT INTO users (username, password) VALUES (?, ?)') {
      const [username, password] = params as [string, string];
      if (currentState.users.has(username)) {
        const error = new Error('Duplicate entry');
        (error as Error & { code?: string }).code = 'ER_DUP_ENTRY';
        throw error;
      }
      currentState.users.set(username, password);
      return [[], []];
    }

    if (normalized === 'UPDATE users SET password = ? WHERE username = ?') {
      const [password, username] = params as [string, string];
      currentState.users.set(username, password);
      return [[], []];
    }

    if (normalized === 'DELETE FROM users WHERE username = ?') {
      const [username] = params as [string];
      currentState.users.delete(username);
      return [[], []];
    }

    if (normalized === 'DELETE FROM user_message_state WHERE username = ?') {
      const [username] = params as [string];
      currentState.messageStates.delete(username);
      return [[], []];
    }

    if (normalized === 'DELETE FROM user_danmaku_settings WHERE username = ?') {
      const [username] = params as [string];
      currentState.danmakuEnabled.delete(username);
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO user_danmaku_settings (username, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)'
    ) {
      const [username, enabled] = params as [string, number | boolean];
      currentState.danmakuEnabled.set(username, Number(enabled) !== 0);
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO user_danmaku_episodes (username, scope_key, episode_id, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE episode_id = VALUES(episode_id), updated_at = VALUES(updated_at)'
    ) {
      const [username, scopeKey, episodeId] = params as [
        string,
        string,
        number,
      ];
      const scopes =
        currentState.danmakuEpisodes.get(username) ?? new Map<string, number>();
      scopes.set(scopeKey, episodeId);
      currentState.danmakuEpisodes.set(username, scopes);
      return [[], []];
    }

    if (
      normalized ===
      'DELETE FROM user_danmaku_episodes WHERE username = ? AND scope_key = ?'
    ) {
      const [username, scopeKey] = params as [string, string];
      currentState.danmakuEpisodes.get(username)?.delete(scopeKey);
      return [[], []];
    }

    if (normalized === 'DELETE FROM user_danmaku_episodes WHERE username = ?') {
      const [username] = params as [string];
      currentState.danmakuEpisodes.delete(username);
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO user_message_state (username, state_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)'
    ) {
      if (!currentState.messageStates.has(String(params[0])))
        currentState.messageStates.set(String(params[0]), String(params[1]));
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized ===
      'UPDATE user_message_state SET state_json = ? WHERE username = ?'
    ) {
      currentState.messageStates.set(String(params[1]), String(params[0]));
      return [{ affectedRows: 1 }, []];
    }

    if (
      normalized ===
      'INSERT INTO user_message_state (username, state_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)'
    ) {
      const [username, stateJson] = params as [string, string];
      currentState.messageStates.set(username, stateJson);
      return [[], []];
    }

    if (/^INSERT(?: IGNORE)? INTO config_subscription /.test(normalized)) {
      const [url, auto_update, last_check, config_file] = params;
      if (!normalized.startsWith('INSERT IGNORE') || !currentState.subscription)
        currentState.subscription = {
          url,
          auto_update,
          last_check,
          config_file,
        };
      return [{ affectedRows: 1 }, []];
    }
    if (/^INSERT(?: IGNORE)? INTO live_source_state /.test(normalized)) {
      const [source_key, channel_number, updated_at] = params;
      if (
        !normalized.startsWith('INSERT IGNORE') ||
        !currentState.liveCounts.has(String(source_key))
      )
        currentState.liveCounts.set(String(source_key), {
          source_key,
          channel_number,
          updated_at,
        });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized === 'DELETE FROM live_source_state WHERE source_key = ?') {
      currentState.liveCounts.delete(String(params[0]));
      return [{ affectedRows: 1 }, []];
    }
    if (/^INSERT(?: IGNORE)? INTO invite_codes /.test(normalized)) {
      const [code, created_at, expires_at, created_by, max_uses, used_count] =
        params;
      if (
        !normalized.startsWith('INSERT IGNORE') ||
        !currentState.inviteCodes.has(String(code))
      )
        currentState.inviteCodes.set(String(code), {
          code,
          created_at,
          expires_at,
          created_by,
          max_uses,
          used_count,
        });
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized.startsWith(
        'UPDATE invite_codes SET used_count = used_count + 1',
      )
    ) {
      const item = currentState.inviteCodes.get(String(params[0]));
      if (
        !item ||
        item.expires_at <= Number(params[1]) ||
        (item.max_uses !== null && item.used_count >= item.max_uses)
      )
        return [{ affectedRows: 0 }, []];
      item.used_count += 1;
      return [{ affectedRows: 1 }, []];
    }
    if (
      normalized.startsWith(
        'UPDATE invite_codes SET used_count = used_count - 1',
      )
    ) {
      const item = currentState.inviteCodes.get(String(params[0]));
      if (item && item.used_count > 0) item.used_count -= 1;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized === 'DELETE FROM invite_codes WHERE code = ?') {
      return [
        {
          affectedRows: Number(
            currentState.inviteCodes.delete(String(params[0])),
          ),
        },
        [],
      ];
    }
    if (
      normalized ===
      'INSERT IGNORE INTO invite_code_usage (code, used_count) VALUES (?, ?)'
    ) {
      const [code, usedCount] = params as [string, number];
      if (!currentState.inviteCodeUsage.has(code)) {
        currentState.inviteCodeUsage.set(code, Number(usedCount));
      }
      return [{ affectedRows: 1 }, []];
    }

    if (
      normalized ===
      'UPDATE invite_code_usage SET used_count = used_count + 1 WHERE code = ? AND used_count < ?'
    ) {
      const [code, maxUses] = params as [string, number];
      const usedCount = currentState.inviteCodeUsage.get(code);
      if (usedCount === undefined || usedCount >= Number(maxUses)) {
        return [{ affectedRows: 0 }, []];
      }
      currentState.inviteCodeUsage.set(code, usedCount + 1);
      return [{ affectedRows: 1 }, []];
    }

    if (
      normalized ===
      'UPDATE invite_code_usage SET used_count = used_count + 1 WHERE code = ?'
    ) {
      const [code] = params as [string];
      const usedCount = currentState.inviteCodeUsage.get(code);
      if (usedCount === undefined) return [{ affectedRows: 0 }, []];
      currentState.inviteCodeUsage.set(code, usedCount + 1);
      return [{ affectedRows: 1 }, []];
    }

    if (
      normalized ===
      'UPDATE invite_code_usage SET used_count = used_count - 1 WHERE code = ? AND used_count > 0'
    ) {
      const [code] = params as [string];
      const usedCount = currentState.inviteCodeUsage.get(code);
      if (!usedCount) return [{ affectedRows: 0 }, []];
      currentState.inviteCodeUsage.set(code, usedCount - 1);
      return [{ affectedRows: 1 }, []];
    }

    if (normalized === 'DELETE FROM invite_code_usage WHERE code = ?') {
      const [code] = params as [string];
      currentState.inviteCodeUsage.delete(code);
      return [[], []];
    }

    if (normalized === 'DELETE FROM invite_code_usage') {
      currentState.inviteCodeUsage.clear();
      return [[], []];
    }

    if (normalized === 'DELETE FROM user_login_activity WHERE username = ?') {
      const [username] = params as [string];
      currentState.loginActivities.delete(username);
      return [[], []];
    }

    if (
      normalized ===
        'INSERT INTO user_login_activity (username, last_login_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)' ||
      normalized ===
        'INSERT INTO user_login_activity (username, last_login_at) VALUES (?, ?)'
    ) {
      const [username, lastLoginAt] = params as [string, number];
      currentState.loginActivities.set(username, Number(lastLoginAt));
      return [[], []];
    }

    if (
      normalized ===
      'INSERT IGNORE INTO user_login_activity (username, last_login_at) SELECT username, ? FROM users'
    ) {
      const [lastLoginAt] = params as [number];
      for (const username of currentState.users.keys()) {
        if (!currentState.loginActivities.has(username)) {
          currentState.loginActivities.set(username, Number(lastLoginAt));
        }
      }
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE record_json = VALUES(record_json)'
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.playRecords, username, key, value);
      return [[], []];
    }

    if (
      normalized ===
      'UPDATE play_records SET record_json = ? WHERE username = ? AND record_key = ? AND BINARY record_json = BINARY ?'
    ) {
      const [value, username, key, snapshot] = params as [
        string,
        string,
        string,
        string,
      ];
      const records = currentState.playRecords.get(username);
      if (!records || records.get(key) !== snapshot) {
        return [{ affectedRows: 0 }, []];
      }
      records.set(key, value);
      return [{ affectedRows: 1 }, []];
    }

    if (
      normalized.startsWith(
        'INSERT INTO favorites (username, favorite_key, favorite_json,',
      )
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.favorites, username, key, value);
      return [[], []];
    }

    if (normalized.startsWith('UPDATE favorites SET favorite_json = ?,')) {
      const value = params[0] as string;
      const [username, key, snapshot] = params.slice(-3) as [
        string,
        string,
        string,
      ];
      const favorites = currentState.favorites.get(username);
      if (!favorites || favorites.get(key) !== snapshot) {
        return [{ affectedRows: 0 }, []];
      }
      favorites.set(key, value);
      return [{ affectedRows: 1 }, []];
    }

    if (
      normalized ===
      'INSERT INTO skip_configs (username, config_key, config_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)'
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.skipConfigs, username, key, value);
      return [[], []];
    }

    if (
      normalized.startsWith(
        'DELETE FROM play_records WHERE username = ? AND record_key IN (',
      )
    ) {
      const [username, ...keys] = params as string[];
      for (const key of keys)
        currentState.playRecords.get(username)?.delete(key);
      return [[], []];
    }

    if (normalized === 'DELETE FROM play_records WHERE username = ?') {
      const [username] = params as [string];
      currentState.playRecords.delete(username);
      return [[], []];
    }

    if (normalized === 'DELETE FROM favorites WHERE username = ?') {
      const [username] = params as [string];
      currentState.favorites.delete(username);
      return [[], []];
    }

    if (normalized === 'DELETE FROM skip_configs WHERE username = ?') {
      const [username] = params as [string];
      currentState.skipConfigs.delete(username);
      return [[], []];
    }

    if (normalized === 'DELETE FROM playback_sessions WHERE username = ?') {
      const [username] = params as [string];
      for (const [id, row] of currentState.playbackSessions.entries()) {
        if (row.username === username) {
          currentState.playbackSessions.delete(id);
        }
      }
      return [[], []];
    }

    if (
      normalized ===
      'DELETE FROM playback_sessions WHERE username = ? AND id = ?'
    ) {
      const [username, id] = params as [string, string];
      if (currentState.playbackSessions.get(id)?.username === username) {
        currentState.playbackSessions.delete(id);
      }
      return [[], []];
    }

    if (normalized === 'DELETE FROM playback_sessions WHERE updated_at < ?') {
      const [cutoff] = params as [number];
      let affectedRows = 0;
      for (const [id, row] of currentState.playbackSessions.entries()) {
        if (Number(row.updated_at || 0) < cutoff) {
          currentState.playbackSessions.delete(id);
          affectedRows += 1;
        }
      }
      return [{ affectedRows }, []];
    }

    if (
      normalized.startsWith('INSERT INTO playback_sessions (') &&
      !normalized.includes('updated_at, measurement_version)')
    ) {
      const [
        id,
        username,
        source,
        videoId,
        episodeIndex,
        title,
        sourceName,
        cover,
        year,
        startedAt,
        endedAt,
        watchSeconds,
        lastPosition,
        totalTime,
        createdAt,
        updatedAt,
      ] = params as [
        string,
        string,
        string,
        string,
        number,
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const existing = currentState.playbackSessions.get(id);
      if (
        existing &&
        (existing.username !== username || existing.measurement_version === 2)
      )
        return [{ affectedRows: 0 }, []];
      currentState.playbackSessions.set(id, {
        id,
        username,
        source,
        video_id: videoId,
        episode_index: episodeIndex,
        title,
        source_name: sourceName,
        cover,
        year,
        started_at: startedAt,
        ended_at: endedAt,
        watch_seconds: watchSeconds,
        last_position: lastPosition,
        total_time: totalTime,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return [[], []];
    }

    if (
      normalized ===
      'DELETE FROM search_history WHERE username = ? AND keyword = ?'
    ) {
      const [username, keyword] = params as [string, string];
      currentState.searchHistory = currentState.searchHistory.filter(
        (row) => !(row.username === username && row.keyword === keyword),
      );
      return [[], []];
    }

    if (
      normalized ===
      'UPDATE search_history SET sort_index = sort_index + 1 WHERE username = ?'
    ) {
      const [username] = params as [string];
      currentState.searchHistory = currentState.searchHistory.map((row) =>
        row.username === username
          ? { ...row, sortIndex: row.sortIndex + 1 }
          : row,
      );
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, 0)'
    ) {
      const [username, keyword] = params as [string, string];
      currentState.searchHistory.push({ username, keyword, sortIndex: 0 });
      return [[], []];
    }

    if (
      normalized ===
      'DELETE FROM search_history WHERE username = ? AND sort_index >= ?'
    ) {
      const [username, limit] = params as [string, number];
      currentState.searchHistory = currentState.searchHistory.filter(
        (row) => row.username !== username || row.sortIndex < limit,
      );
      return [[], []];
    }

    if (normalized === 'DELETE FROM search_history WHERE username = ?') {
      const [username] = params as [string];
      currentState.searchHistory = currentState.searchHistory.filter(
        (row) => row.username !== username,
      );
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO admin_config (id, config_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)'
    ) {
      const [configJson] = params as [string];
      currentState.adminConfig = configJson;
      return [[], []];
    }

    if (
      normalized === 'INSERT INTO admin_config (id, config_json) VALUES (1, ?)'
    ) {
      const [configJson] = params as [string];
      currentState.adminConfig = configJson;
      return [[], []];
    }

    if (
      normalized.startsWith(
        'INSERT INTO source_route_stats (source, route_mode, bucket_date, success_count, failure_count, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE',
      )
    ) {
      const [
        source,
        routeMode,
        bucketDate,
        successCount,
        failureCount,
        updatedAt,
      ] = params as [
        string,
        SourceRouteStatsRow['routeMode'],
        string,
        number,
        number,
        number,
      ];
      const row = currentState.sourceRouteStats.find(
        (item) =>
          item.source === source &&
          item.routeMode === routeMode &&
          item.bucketDate === bucketDate,
      );
      if (row) {
        row.successCount += successCount;
        row.failureCount += failureCount;
        row.updatedAt = updatedAt;
      } else {
        currentState.sourceRouteStats.push({
          source,
          routeMode,
          bucketDate,
          successCount,
          failureCount,
          updatedAt,
        });
      }
      return [[], []];
    }

    if (normalized.startsWith('INSERT INTO source_health_search (')) {
      const [
        source,
        bucketDate,
        okCount,
        emptyCount,
        errorCount,
        latencyMsSum,
        latencySamples,
      ] = params as [string, string, number, number, number, number, number];
      const existing = currentState.healthSearch.find(
        (row) => row.source === source && row.bucketDate === bucketDate,
      );
      if (existing) {
        existing.okCount += okCount;
        existing.emptyCount += emptyCount;
        existing.errorCount += errorCount;
        existing.latencyMsSum += latencyMsSum;
        existing.latencySamples += latencySamples;
      } else {
        currentState.healthSearch.push({
          source,
          bucketDate,
          okCount,
          emptyCount,
          errorCount,
          latencyMsSum,
          latencySamples,
        });
      }
      return [[], []];
    }
    if (normalized.startsWith('INSERT INTO source_health_play (')) {
      const [source, bucketDate, reporter, successCount, failureCount] =
        params as [string, string, string, number, number];
      const existing = currentState.healthPlay.find(
        (row) =>
          row.source === source &&
          row.bucketDate === bucketDate &&
          row.reporter === reporter,
      );
      if (existing) {
        existing.successCount += successCount;
        existing.failureCount += failureCount;
      } else {
        currentState.healthPlay.push({
          source,
          bucketDate,
          reporter,
          successCount,
          failureCount,
        });
      }
      return [[], []];
    }
    for (const [table, key] of [
      ['source_health_search', 'healthSearch'],
      ['source_health_play', 'healthPlay'],
    ] as const) {
      if (normalized === `DELETE FROM ${table} WHERE bucket_date < ?`) {
        const beforeDate = params[0] as string;
        if (key === 'healthSearch')
          currentState.healthSearch = currentState.healthSearch.filter(
            (row) => row.bucketDate >= beforeDate,
          );
        else
          currentState.healthPlay = currentState.healthPlay.filter(
            (row) => row.bucketDate >= beforeDate,
          );
        return [[], []];
      }
    }

    if (normalized === 'DELETE FROM source_route_stats WHERE bucket_date < ?') {
      currentState.sourceRouteStats = currentState.sourceRouteStats.filter(
        (row) => row.bucketDate >= (params[0] as string),
      );
      return [[], []];
    }

    throw new Error(`Unhandled execute SQL: ${normalized}`);
  };

  const runQuery = async (
    sql: string,
    params: unknown[] = [],
    currentState: FakeState,
  ) => {
    const normalized = normalizeSql(sql);
    if (normalized === 'SELECT COUNT(*) AS total FROM announcements')
      return [[{ total: currentState.announcements.size }], []];
    if (normalized.startsWith('SELECT * FROM announcements')) {
      if (normalized === 'SELECT * FROM announcements WHERE id = ?') {
        const row = currentState.announcements.get(String(params[0]));
        return [row ? [{ ...row }] : [], []];
      }
      let rows = [...currentState.announcements.values()];
      let index = 0;
      if (normalized.includes('WHERE published_at IS NOT NULL')) {
        rows = rows.filter((row) => row.published_at !== null);
        if (normalized.includes('published_at > ?')) {
          const since = Number(params[index++]);
          rows = rows.filter((row) => Number(row.published_at) > since);
        }
        if (normalized.includes('published_at < ?')) {
          const time = Number(params[index++]);
          const equalTime = Number(params[index++]);
          const id = String(params[index++]);
          rows = rows.filter(
            (row) =>
              Number(row.published_at) < time ||
              (Number(row.published_at) === equalTime && row.id < id),
          );
        }
      }
      rows.sort((a, b) => {
        const draftOrder =
          Number(b.published_at === null) - Number(a.published_at === null);
        const timeOrder =
          Number(b.published_at ?? b.created_at) -
          Number(a.published_at ?? a.created_at);
        return (
          draftOrder || timeOrder || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
        );
      });
      if (!normalized.endsWith('LIMIT ?'))
        throw new Error('Expected SQL limit');
      return [
        rows.slice(0, Number(params[index])).map((row) => ({ ...row })),
        [],
      ];
    }

    if (
      normalized.includes('FROM user_danmaku ') &&
      !normalized.includes('FROM user_danmaku_')
    ) {
      let rows = [...currentState.userDanmaku.values()];
      let offset = 0;
      if (normalized.includes('episode_key = ?')) {
        const key = params[offset++];
        rows = rows.filter((row) => row.episodeKey === key);
      }
      if (normalized.includes('created_at < ?')) {
        const [time, , id] = params.slice(offset);
        offset += 3;
        rows = rows.filter(
          (row) =>
            row.createdAt < Number(time) ||
            (row.createdAt === Number(time) && row.id < String(id)),
        );
      }
      if (normalized.includes('LOWER(text)')) {
        const q = String(params[offset])
          .slice(1, -1)
          .replace(/!([!%_])/g, '$1')
          .toLowerCase();
        offset += 2;
        rows = rows.filter(
          (row) =>
            row.text.toLowerCase().includes(q) ||
            row.username.toLowerCase().includes(q),
        );
      }
      if (normalized.includes('username = ?')) {
        const username = params[offset++];
        rows = rows.filter((row) => row.username === username);
      }
      rows.sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      );
      const literalLimit = normalized.match(/LIMIT (\d+)$/);
      const limit = literalLimit
        ? Number(literalLimit[1])
        : normalized.endsWith('LIMIT ?')
          ? Number(params[offset])
          : rows.length;
      return [rows.slice(0, limit), []];
    }

    if (normalized.startsWith('SELECT * FROM config_subscription WHERE id = 1'))
      return [currentState.subscription ? [currentState.subscription] : [], []];
    if (
      normalized === 'SELECT source_key, channel_number FROM live_source_state'
    )
      return [[...currentState.liveCounts.values()], []];
    if (normalized === 'SHOW COLUMNS FROM playback_sessions')
      return [[{ Field: 'measurement_version' }], []];
    if (normalized.startsWith('SELECT completed_at FROM storage_migrations'))
      return [[{ completed_at: currentState.historyMigrated ? 1 : 0 }], []];
    if (normalized.startsWith('SELECT ranked.*, p.record_json'))
      return [[], []];
    if (
      normalized ===
      'SELECT id FROM playback_sessions WHERE updated_at < ? FOR UPDATE'
    )
      return [
        [...currentState.playbackSessions.values()].filter(
          (row) => Number(row.updated_at) < Number(params[0]),
        ),
        [],
      ];
    if (
      normalized.startsWith('SELECT username') &&
      normalized.includes('FROM playback_sessions WHERE id = ?')
    ) {
      const row = currentState.playbackSessions.get(String(params[0]));
      return [row ? [row] : [], []];
    }
    if (normalized.startsWith('SELECT COALESCE(SUM(watch_ms)'))
      return [
        [
          {
            total: currentState.watchBuckets
              .filter(
                (row) =>
                  row.username === params[0] && row.session_id === params[1],
              )
              .reduce((sum, row) => sum + Number(row.watch_ms), 0),
          },
        ],
        [],
      ];
    if (
      normalized.startsWith('SELECT id FROM watch_history WHERE username = ?')
    ) {
      return [
        currentState.watchHistory.filter(
          (row) =>
            row.username === params[0] &&
            (params.length === 4
              ? row.id === params[1] &&
                row.source === params[2] &&
                row.video_id === params[3]
              : row.source === params[1] && row.video_id === params[2]),
        ),
        [],
      ];
    }
    if (
      normalized.includes('FROM watch_history WHERE username = ? ORDER BY') ||
      normalized.includes('FROM watch_history WHERE username = ? AND')
    ) {
      let rows = currentState.watchHistory.filter(
        (row) => row.username === params[0],
      );
      let offset = 1;
      if (normalized.includes('last_watched_at < ?')) {
        rows = rows.filter(
          (row) =>
            row.last_watched_at < Number(params[1]) ||
            (row.last_watched_at === Number(params[1]) &&
              row.id < String(params[3])),
        );
        offset = 4;
      }
      if (normalized.includes('LIKE LOWER(?)')) {
        const keyword = String(params[offset])
          .slice(1, -1)
          .replace(/!([!%_])/g, '$1')
          .toLowerCase();
        rows = rows.filter((row) => row.title.toLowerCase().includes(keyword));
      }
      rows.sort(
        (a, b) =>
          b.last_watched_at - a.last_watched_at || (a.id < b.id ? 1 : -1),
      );
      return [rows.slice(0, Number(params.at(-1))), []];
    }
    if (normalized === 'SHOW COLUMNS FROM favorites')
      return [
        [
          'title_norm',
          'year_norm',
          'year_number',
          'search_text',
          'saved_at',
          'library_valid',
          'watch_status',
          'watched_at',
          'projection_version',
        ].map((Field) => ({ Field })),
        [],
      ];
    if (normalized === 'SHOW INDEX FROM favorites')
      return [
        [
          'idx_favorites_saved',
          'idx_favorites_work',
          'idx_favorites_projection',
        ].map((Key_name) => ({ Key_name })),
        [],
      ];
    if (
      normalized ===
      'SELECT username, favorite_key, favorite_json FROM favorites WHERE projection_version < 2 LIMIT 250'
    )
      return [[], []];
    if (
      normalized.startsWith(
        'SELECT username, role, banned, enabled_apis FROM user_access',
      )
    ) {
      const row = currentState.userAccess.get(String(params[0]));
      return [row ? [{ ...row }] : [], []];
    }
    if (normalized === 'SELECT username FROM user_access ORDER BY username')
      return [
        [...currentState.userAccess.keys()]
          .sort()
          .map((username) => ({ username })),
        [],
      ];
    if (normalized.startsWith('SELECT group_name FROM user_group_members'))
      return [
        currentState.userGroups
          .filter((row) => row.username === params[0])
          .sort((a, b) => a.position - b.position)
          .map((row) => ({ group_name: row.group_name })),
        [],
      ];
    if (normalized.startsWith('SELECT * FROM oauth_identities'))
      return [
        (currentState.social.oauth_identities || []).filter(
          (row) =>
            row[
              normalized.includes('provider_user_id =')
                ? 'provider_user_id'
                : 'username'
            ] === params[0],
        ),
        [],
      ];
    if (
      normalized === 'SELECT username FROM users WHERE username = ? FOR UPDATE'
    )
      return [
        currentState.users.has(String(params[0]))
          ? [{ username: params[0] }]
          : [],
        [],
      ];
    const socialRows = querySocial(normalized, params, currentState);
    if (socialRows !== undefined) return [socialRows, []];

    if (normalized.includes('FROM video_reviews')) {
      let rows = [...currentState.videoReviews.values()];
      const compareText = (a: string, b: string) =>
        a === b ? 0 : a < b ? -1 : 1;
      const sortRows = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
        b.review.updated_at - a.review.updated_at ||
        compareText(b.username, a.username) ||
        compareText(b.review.title_norm, a.review.title_norm) ||
        compareText(b.review.year, a.review.year);
      if (
        normalized.startsWith('SELECT COUNT(*) AS count FROM video_reviews')
      ) {
        const matching = normalized.includes('WHERE username = ?')
          ? rows.filter((row) => row.username === params[0])
          : rows.filter(
              (row) =>
                row.review.is_public &&
                row.review.title_norm === params[0] &&
                (!params[1] ||
                  row.review.year === params[1] ||
                  row.review.year === ''),
            );
        return [[{ count: matching.length }], []];
      }
      if (normalized.startsWith('SELECT title_norm, year,')) {
        return [
          rows
            .filter((row) => row.username === params[0])
            .map(({ review }) => ({
              title_norm: review.title_norm,
              year: review.year,
              rating: review.rating,
            })),
          [],
        ];
      }
      if (normalized.includes('LOWER(CONCAT(')) {
        rows = rows.filter(
          (row) =>
            row.username === params[0] &&
            `${row.review.title} ${row.review.content}`
              .toLowerCase()
              .includes(String(params[1]).toLowerCase()),
        );
        if (normalized.includes('AS `all`'))
          return [
            [
              {
                all: rows.length,
                public: rows.filter((row) => row.review.is_public).length,
                private: rows.filter((row) => !row.review.is_public).length,
                text: rows.filter((row) => row.review.rating === null).length,
              },
            ],
            [],
          ];
        const rank = (review: VideoReview) =>
          normalized.includes('101 - ROUND')
            ? review.rating === null
              ? 0
              : 101 - Math.round(review.rating * 10)
            : normalized.includes('COALESCE(ROUND')
              ? review.rating === null
                ? 0
                : Math.round(review.rating * 10)
              : review.updated_at;
        if (normalized.includes('AND is_public = 1'))
          rows = rows.filter((row) => row.review.is_public);
        if (normalized.includes('AND is_public = 0'))
          rows = rows.filter((row) => !row.review.is_public);
        if (normalized.includes('END IS NULL'))
          rows = rows.filter((row) => row.review.rating === null);
        rows.sort((a, b) => rank(b.review) - rank(a.review) || sortRows(a, b));
        if (params.length > 3)
          rows = rows.filter(
            ({ review }) =>
              rank(review) < Number(params[3]) ||
              (rank(review) === Number(params[3]) &&
                (review.updated_at < Number(params[5]) ||
                  (review.updated_at === Number(params[5]) &&
                    (review.title_norm < String(params[7]) ||
                      (review.title_norm === params[7] &&
                        review.year < String(params[9])))))),
          );
        return [
          rows
            .slice(0, 21)
            .map((row) => ({ review_json: JSON.stringify(row.review) })),
          [],
        ];
      }
      if (
        normalized.includes('JOIN user_profiles p ON p.username = r.username')
      ) {
        const profileId = (username: string) =>
          currentState.social.user_profiles.find((p) => p.username === username)
            ?.profile_id ?? '';
        rows = rows.filter(
          (row) =>
            row.review.is_public &&
            row.review.title_norm === params[0] &&
            (!params[1] ||
              row.review.year === params[1] ||
              row.review.year === ''),
        );
        rows.sort(
          (a, b) =>
            b.review.updated_at - a.review.updated_at ||
            compareText(profileId(b.username), profileId(a.username)) ||
            compareText(b.review.year, a.review.year),
        );
        if (params.length > 3)
          rows = rows.filter(
            (row) =>
              row.review.updated_at < Number(params[3]) ||
              (row.review.updated_at === Number(params[3]) &&
                (profileId(row.username) < String(params[5]) ||
                  (profileId(row.username) === params[5] &&
                    row.review.year < String(params[7])))),
          );
        return [
          rows.slice(0, 21).map((row) => ({
            username: row.username,
            profile_id: profileId(row.username),
            review_json: JSON.stringify(row.review),
          })),
          [],
        ];
      }
      if (
        normalized.includes('WHERE username = ? AND is_public = 1') &&
        normalized.includes('LIMIT 21')
      ) {
        rows = rows
          .filter((row) => row.username === params[0] && row.review.is_public)
          .sort(sortRows);
        if (params.length > 1)
          rows = rows.filter(
            ({ review }) =>
              review.updated_at < Number(params[1]) ||
              (review.updated_at === Number(params[1]) &&
                (review.title_norm < String(params[3]) ||
                  (review.title_norm === params[3] &&
                    review.year < String(params[5])))),
          );
        return [
          rows.slice(0, 21).map((row) => ({
            username: row.username,
            review_json: JSON.stringify(row.review),
          })),
          [],
        ];
      }
      if (normalized.includes('WHERE username = ?')) {
        rows = rows.filter((row) => row.username === params[0]);
        if (normalized.includes('title_norm = ?')) {
          rows = rows.filter(
            (row) =>
              row.review.title_norm === params[1] &&
              (params.length === 2 ||
                row.review.year === params[2] ||
                row.review.year === ''),
          );
        }
        rows.sort(
          (a, b) =>
            (params.length > 2
              ? Number(b.review.year === params[2]) -
                Number(a.review.year === params[2])
              : 0) || sortRows(a, b),
        );
        if (normalized.includes('is_public = 1'))
          rows = rows.filter(
            (row) =>
              row.review.is_public &&
              (!normalized.includes('year = ?') ||
                row.review.year === params[2]),
          );
        if (normalized.includes('LIMIT 1')) rows = rows.slice(0, 1);
      } else {
        rows = rows.filter((row) => row.review.is_public);
        if (normalized.includes('WHERE title_norm = ?')) {
          rows = rows.filter(
            (row) =>
              row.review.title_norm === params[0] &&
              (!params[1] ||
                row.review.year === params[1] ||
                row.review.year === ''),
          );
          if (normalized.includes(' AS bucket')) {
            const counts = new Map<number, number>();
            for (const row of rows)
              if (row.review.rating !== null) {
                const bucket = Math.floor(row.review.rating);
                counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
              }
            return [
              [...counts].map(([bucket, count]) => ({ bucket, count })),
              [],
            ];
          }
          if (normalized.startsWith('SELECT AVG(')) {
            const rated = rows.filter((row) => row.review.rating !== null);
            return [
              [
                {
                  average: rated.length
                    ? String(
                        rated.reduce(
                          (sum, row) => sum + row.review.rating!,
                          0,
                        ) / rated.length,
                      )
                    : null,
                  count: rated.length,
                },
              ],
              [],
            ];
          }
          rows.sort(sortRows);
          rows = rows.slice(0, 50);
        } else {
          const q = String(params[0]).toLowerCase();
          rows = rows.filter(
            (row) =>
              row.review.title.toLowerCase().includes(q) ||
              row.username.toLowerCase().includes(q),
          );
          rows.sort(sortRows);
          if (params[3]) {
            const after = {
              username: String(params[6]),
              review: {
                updated_at: Number(params[4]),
                title_norm: String(params[8]),
                year: String(params[10]),
              } as VideoReview,
            };
            rows = rows.filter((row) => sortRows(row, after) > 0);
          }
          rows = rows.slice(0, 31);
        }
      }
      return [
        rows.map((row) => ({
          username: row.username,
          review_json: JSON.stringify(row.review),
        })),
        [],
      ];
    }

    if (
      normalized ===
      'SELECT record_json FROM play_records WHERE username = ? AND record_key = ? LIMIT 1'
    ) {
      const [username, key] = params as [string, string];
      return [
        [{ record_json: currentState.playRecords.get(username)?.get(key) }],
        [],
      ];
    }

    if (
      normalized ===
      'SELECT record_key, record_json FROM play_records WHERE username = ?'
    ) {
      const [username] = params as [string];
      return [
        getJsonRows(
          currentState.playRecords,
          username,
          'record_key',
          'record_json',
        ),
        [],
      ];
    }

    if (
      normalized.startsWith(
        'SELECT record_key, record_json FROM play_records WHERE username = ? AND',
      ) &&
      normalized.includes(STALE_METADATA_SQL_MARKER)
    ) {
      const hasCursor = params.length === 5;
      const username = params[0] as string;
      const cursorKey = hasCursor ? (params[1] as string) : undefined;
      const staleBefore = params[hasCursor ? 2 : 1] as number;
      const now = params[hasCursor ? 3 : 2] as number;
      const limit = params.at(-1) as number;
      const rows = selectStalePlayRecordRows(
        currentState,
        username,
        now,
        now - staleBefore,
        cursorKey,
      );
      return [rows.slice(0, limit), []];
    }

    if (
      normalized.startsWith(
        'SELECT record_key, record_json FROM play_records',
      ) &&
      normalized.includes(TRACKING_SQL_MARKER)
    ) {
      const hasCursor = params.length === 5;
      const saveTimeOrder = normalized.includes(
        "ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.save_time')) AS UNSIGNED)",
      );
      let rows = selectUnreadTrackingRows(
        currentState,
        params[0] as string,
        hasCursor && !saveTimeOrder ? (params[1] as number) : undefined,
        hasCursor && !saveTimeOrder ? (params[3] as string) : undefined,
      );
      if (saveTimeOrder) {
        rows = rows
          .filter((row) => {
            const time = JSON.parse(row.record_json).save_time;
            return (
              !hasCursor ||
              time < Number(params[1]) ||
              (time === params[1] && row.record_key < String(params[3]))
            );
          })
          .sort(
            (left, right) =>
              JSON.parse(right.record_json).save_time -
                JSON.parse(left.record_json).save_time ||
              right.record_key.localeCompare(left.record_key),
          );
      }
      const limit = params.at(-1) as number;
      return [rows.slice(0, limit), []];
    }

    if (
      normalized.startsWith('SELECT COUNT(*) AS count FROM play_records') &&
      normalized.includes(TRACKING_SQL_MARKER)
    ) {
      const rows = selectUnreadTrackingRows(currentState, params[0] as string);
      return [[{ count: rows.length }], []];
    }

    if (
      normalized.startsWith(
        'SELECT record_key, record_json FROM play_records WHERE username = ? ORDER BY',
      )
    ) {
      const [username, limit] = params as [string, number];
      const rows = getJsonRows(
        currentState.playRecords,
        username,
        'record_key',
        'record_json',
      ).sort((left, right) => {
        const timeDifference =
          JSON.parse(right.record_json).save_time -
          JSON.parse(left.record_json).save_time;
        return (
          timeDifference || right.record_key.localeCompare(left.record_key)
        );
      });
      return [rows.slice(0, limit), []];
    }

    if (
      normalized.startsWith(
        'SELECT record_key, record_json FROM play_records WHERE username = ? AND (',
      )
    ) {
      const [username, cursorTime, , cursorKey, limit] = params as [
        string,
        number,
        number,
        string,
        number,
      ];
      const rows = getJsonRows(
        currentState.playRecords,
        username,
        'record_key',
        'record_json',
      )
        .filter((row) => {
          const saveTime = JSON.parse(row.record_json).save_time;
          return (
            saveTime < cursorTime ||
            (saveTime === cursorTime && row.record_key < cursorKey)
          );
        })
        .sort((left, right) => {
          const timeDifference =
            JSON.parse(right.record_json).save_time -
            JSON.parse(left.record_json).save_time;
          return (
            timeDifference || right.record_key.localeCompare(left.record_key)
          );
        });
      return [rows.slice(0, limit), []];
    }

    if (
      normalized ===
      'SELECT COUNT(*) AS count FROM play_records WHERE username = ?'
    ) {
      const [username] = params as [string];
      return [
        [{ count: currentState.playRecords.get(username)?.size || 0 }],
        [],
      ];
    }

    if (
      normalized ===
      'SELECT favorite_json FROM favorites WHERE username = ? AND favorite_key = ? LIMIT 1'
    ) {
      const [username, key] = params as [string, string];
      return [
        [{ favorite_json: currentState.favorites.get(username)?.get(key) }],
        [],
      ];
    }

    if (
      normalized ===
      'SELECT favorite_key, favorite_json FROM favorites WHERE username = ?'
    ) {
      const [username] = params as [string];
      return [
        getJsonRows(
          currentState.favorites,
          username,
          'favorite_key',
          'favorite_json',
        ),
        [],
      ];
    }

    if (
      normalized.startsWith(
        'SELECT favorite_key, favorite_json FROM favorites WHERE username = ? AND',
      ) &&
      normalized.includes(STALE_METADATA_SQL_MARKER)
    ) {
      const hasCursor = params.length === 5;
      const username = params[0] as string;
      const cursorKey = hasCursor ? (params[1] as string) : undefined;
      const staleBefore = params[hasCursor ? 2 : 1] as number;
      const now = params[hasCursor ? 3 : 2] as number;
      const limit = params.at(-1) as number;
      const rows = selectStaleFavoriteRows(
        currentState,
        username,
        now,
        now - staleBefore,
        cursorKey,
      );
      return [rows.slice(0, limit), []];
    }

    if (
      normalized ===
      'SELECT config_json FROM skip_configs WHERE username = ? AND config_key = ? LIMIT 1'
    ) {
      const [username, key] = params as [string, string];
      return [
        [{ config_json: currentState.skipConfigs.get(username)?.get(key) }],
        [],
      ];
    }

    if (
      normalized ===
      'SELECT config_key, config_json FROM skip_configs WHERE username = ?'
    ) {
      const [username] = params as [string];
      return [
        getJsonRows(
          currentState.skipConfigs,
          username,
          'config_key',
          'config_json',
        ),
        [],
      ];
    }

    if (
      normalized ===
      'SELECT id, source, video_id, episode_index, title, source_name, cover, year, started_at, ended_at, watch_seconds, last_position, total_time, created_at, updated_at FROM playback_sessions WHERE username = ? ORDER BY started_at DESC LIMIT ?'
    ) {
      const [username, limit] = params as [string, number];
      return [
        Array.from(currentState.playbackSessions.values())
          .filter((row) => row.username === username)
          .sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0))
          .slice(0, limit),
        [],
      ];
    }

    if (
      normalized ===
      'SELECT id, source, video_id, episode_index, title, source_name, cover, year, started_at, ended_at, watch_seconds, last_position, total_time, created_at, updated_at FROM playback_sessions WHERE username = ? ORDER BY started_at DESC'
    ) {
      const [username] = params as [string];
      return [
        Array.from(currentState.playbackSessions.values())
          .filter((row) => row.username === username)
          .sort(
            (a, b) => Number(b.started_at || 0) - Number(a.started_at || 0),
          ),
        [],
      ];
    }

    if (
      normalized ===
      'SELECT source, video_id, title, cover, year, started_at, ended_at, watch_seconds FROM playback_sessions WHERE username = ? AND started_at >= ? AND started_at < ? AND watch_seconds > 0'
    ) {
      const [username, start, end] = params as [string, number, number];
      return [
        Array.from(currentState.playbackSessions.values()).filter(
          (row) =>
            row.username === username &&
            Number(row.started_at) >= start &&
            Number(row.started_at) < end &&
            Number(row.watch_seconds) > 0,
        ),
        [],
      ];
    }

    if (
      normalized ===
      'SELECT keyword FROM search_history WHERE username = ? ORDER BY sort_index ASC'
    ) {
      const [username] = params as [string];
      return [
        currentState.searchHistory
          .filter((row) => row.username === username)
          .sort((a, b) => a.sortIndex - b.sortIndex)
          .map((row) => ({ keyword: row.keyword })),
        [],
      ];
    }

    if (normalized === 'SELECT username FROM users ORDER BY username ASC') {
      return [
        Array.from(currentState.users.keys())
          .sort((a, b) => a.localeCompare(b))
          .map((username) => ({ username })),
        [],
      ];
    }

    if (
      normalized === 'SELECT config_json FROM admin_config WHERE id = 1 LIMIT 1'
    ) {
      return [[{ config_json: currentState.adminConfig }], []];
    }

    if (
      normalized ===
        'SELECT state_json FROM user_message_state WHERE username = ? LIMIT 1' ||
      normalized ===
        'SELECT state_json FROM user_message_state WHERE username = ? FOR UPDATE'
    ) {
      const [username] = params as [string];
      const stateJson = currentState.messageStates.get(username);
      return [stateJson ? [{ state_json: stateJson }] : [], []];
    }

    if (
      normalized ===
      'SELECT episode_id FROM user_danmaku_episodes WHERE username = ? AND scope_key = ?'
    ) {
      const [username, scopeKey] = params as [string, string];
      const episodeId = currentState.danmakuEpisodes
        .get(username)
        ?.get(scopeKey);
      return [episodeId === undefined ? [] : [{ episode_id: episodeId }], []];
    }

    if (
      normalized ===
      'SELECT enabled FROM user_danmaku_settings WHERE username = ? LIMIT 1'
    ) {
      const [username] = params as [string];
      const enabled = currentState.danmakuEnabled.get(username);
      return [enabled === undefined ? [] : [{ enabled: enabled ? 1 : 0 }], []];
    }

    if (
      normalized ===
      'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE'
    ) {
      return [
        currentState.adminConfig
          ? [{ config_json: currentState.adminConfig }]
          : [],
        [],
      ];
    }
    if (
      normalized ===
      'SELECT * FROM invite_codes ORDER BY created_at DESC, code DESC'
    ) {
      return [[...currentState.inviteCodes.values()], []];
    }
    if (normalized.startsWith('SELECT code FROM invite_codes WHERE code = ?')) {
      const item = currentState.inviteCodes.get(String(params[0]));
      return [
        item &&
        item.expires_at > Number(params[1]) &&
        (item.max_uses === null || item.used_count < item.max_uses)
          ? [item]
          : [],
        [],
      ];
    }
    if (
      normalized.startsWith(
        'SELECT COUNT(*) AS total FROM invite_codes WHERE expires_at > ?',
      )
    ) {
      return [
        [
          {
            total: [...currentState.inviteCodes.values()].filter(
              (item) =>
                item.expires_at > Number(params[0]) &&
                (item.max_uses === null || item.used_count < item.max_uses),
            ).length,
          },
        ],
        [],
      ];
    }

    if (normalized === 'SELECT code, used_count FROM invite_code_usage') {
      return [
        Array.from(currentState.inviteCodeUsage.entries()).map(
          ([code, usedCount]) => ({ code, used_count: usedCount }),
        ),
        [],
      ];
    }

    if (
      normalized ===
        'SELECT last_login_at FROM user_login_activity WHERE username = ? LIMIT 1' ||
      normalized ===
        'SELECT last_login_at FROM user_login_activity WHERE username = ? FOR UPDATE'
    ) {
      const [username] = params as [string];
      const lastLoginAt = currentState.loginActivities.get(username);
      return [
        lastLoginAt === undefined ? [] : [{ last_login_at: lastLoginAt }],
        [],
      ];
    }

    if (
      normalized === 'SELECT username, last_login_at FROM user_login_activity'
    ) {
      return [
        Array.from(currentState.loginActivities.entries()).map(
          ([username, lastLoginAt]) => ({
            username,
            last_login_at: lastLoginAt,
          }),
        ),
        [],
      ];
    }

    if (
      normalized === 'SELECT password FROM users WHERE username = ? LIMIT 1'
    ) {
      const [username] = params as [string];
      return [[{ password: currentState.users.get(username) }], []];
    }

    if (normalized === 'SELECT 1 AS v FROM users WHERE username = ? LIMIT 1') {
      const [username] = params as [string];
      return [currentState.users.has(username) ? [{ v: 1 }] : [], []];
    }

    if (
      normalized ===
      'SELECT source, route_mode, COALESCE(SUM(success_count), 0) AS success_count, COALESCE(SUM(failure_count), 0) AS failure_count FROM source_route_stats WHERE bucket_date >= ? GROUP BY source, route_mode'
    ) {
      const [sinceDate] = params as [string];
      const grouped = new Map<
        string,
        {
          source: string;
          route_mode: SourceRouteStatsRow['routeMode'];
          success_count: number;
          failure_count: number;
        }
      >();

      for (const row of currentState.sourceRouteStats) {
        if (row.bucketDate < sinceDate) continue;
        const key = `${row.source}:${row.routeMode}`;
        const current = grouped.get(key) || {
          source: row.source,
          route_mode: row.routeMode,
          success_count: 0,
          failure_count: 0,
        };
        current.success_count += row.successCount;
        current.failure_count += row.failureCount;
        grouped.set(key, current);
      }

      return [Array.from(grouped.values()), []];
    }

    if (
      normalized ===
      'SELECT source, route_mode, bucket_date, success_count, failure_count FROM source_route_stats ORDER BY bucket_date ASC, source ASC, route_mode ASC'
    ) {
      return [
        [...currentState.sourceRouteStats]
          .sort((a, b) =>
            `${a.bucketDate}:${a.source}:${a.routeMode}`.localeCompare(
              `${b.bucketDate}:${b.source}:${b.routeMode}`,
            ),
          )
          .map((row) => ({
            source: row.source,
            route_mode: row.routeMode,
            bucket_date: row.bucketDate,
            success_count: row.successCount,
            failure_count: row.failureCount,
          })),
        [],
      ];
    }

    if (
      normalized ===
      'SELECT source, bucket_date AS bucketDate, ok_count AS okCount, empty_count AS emptyCount, error_count AS errorCount, latency_ms_sum AS latencyMsSum, latency_samples AS latencySamples FROM source_health_search WHERE bucket_date >= ? ORDER BY bucket_date ASC, source ASC'
    ) {
      return [
        currentState.healthSearch
          .filter((row) => row.bucketDate >= (params[0] as string))
          .sort(
            (a, b) =>
              a.bucketDate.localeCompare(b.bucketDate) ||
              a.source.localeCompare(b.source),
          )
          .map((row) => ({ ...row })),
        [],
      ];
    }
    if (
      normalized ===
      'SELECT source, SUM(CASE WHEN success_count > 0 THEN 1 ELSE 0 END) AS successReporterDays, SUM(CASE WHEN success_count = 0 AND failure_count > 0 THEN 1 ELSE 0 END) AS failureReporterDays, MAX(CASE WHEN success_count > 0 THEN bucket_date ELSE NULL END) AS lastSuccessDate FROM source_health_play WHERE bucket_date >= ? GROUP BY source ORDER BY source ASC'
    ) {
      const summaries = new Map<
        string,
        {
          source: string;
          successReporterDays: number;
          failureReporterDays: number;
          lastSuccessDate: string | null;
        }
      >();
      for (const row of currentState.healthPlay) {
        if (row.bucketDate < (params[0] as string)) continue;
        const summary = summaries.get(row.source) ?? {
          source: row.source,
          successReporterDays: 0,
          failureReporterDays: 0,
          lastSuccessDate: null,
        };
        if (row.successCount > 0) {
          summary.successReporterDays++;
          if (
            !summary.lastSuccessDate ||
            row.bucketDate > summary.lastSuccessDate
          )
            summary.lastSuccessDate = row.bucketDate;
        } else if (row.failureCount > 0) summary.failureReporterDays++;
        summaries.set(row.source, summary);
      }
      return [
        [...summaries.values()]
          .sort((a, b) => a.source.localeCompare(b.source))
          .map((row) => ({
            ...row,
            successReporterDays: String(row.successReporterDays),
            failureReporterDays: String(row.failureReporterDays),
          })),
        [],
      ];
    }

    throw new Error(`Unhandled query SQL: ${normalized}`);
  };

  return {
    async execute(sql: string, params?: unknown[]) {
      return runExecute(sql, params, state);
    },
    async query(sql: string, params?: unknown[]) {
      queryCount += 1;
      return runQuery(sql, params, state);
    },
    getQueryCount() {
      return queryCount;
    },
    resetQueryCount() {
      queryCount = 0;
    },
    reset() {
      state = createState();
      queryCount = 0;
    },
    async getConnection() {
      let transactionState = cloneState(state);
      let unlock = () => {};
      return {
        async beginTransaction() {
          const previous = transactionQueue;
          transactionQueue = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          await previous;
          transactionState = cloneState(state);
        },
        async query(sql: string, params?: unknown[]) {
          return runQuery(sql, params, transactionState);
        },
        async commit() {
          state = cloneState(transactionState);
          unlock();
        },
        async rollback() {
          unlock();
        },
        async execute(sql: string, params?: unknown[]) {
          return runExecute(sql, params, transactionState);
        },
        release() {},
      };
    },
  };
}

const fakePool = createFakePool();

beforeEach(() => fakePool.reset());

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: {
    createPool: jest.fn(() => fakePool),
  },
}));

import { MySqlStorage } from '../mysql.db';
import type {
  Favorite,
  PlaybackSession,
  PlayRecord,
  SkipConfig,
  SourceRouteStatsItem,
  VideoReview,
} from '../types';

const playRecord: PlayRecord = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  index: 1,
  total_episodes: 12,
  play_time: 10,
  total_time: 120,
  save_time: 1000,
  search_title: 'Demo',
};

const favorite: Favorite = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  total_episodes: 12,
  save_time: 1000,
  search_title: 'Demo',
};

const skipConfig: SkipConfig = {
  enable: true,
  intro_time: 90,
  outro_time: 30,
};

const playbackSession: PlaybackSession = {
  id: 'session_demo_1',
  source: 'source',
  video_id: '1',
  episode_index: 1,
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  started_at: 1000,
  ended_at: 2000,
  watch_seconds: 60,
  last_position: 60,
  total_time: 120,
  created_at: 1000,
  updated_at: 2000,
};

function sortRouteStats(items: SourceRouteStatsItem[]) {
  return [...items].sort((a, b) =>
    `${a.source}:${a.routeMode}`.localeCompare(`${b.source}:${b.routeMode}`),
  );
}

describe('mysql storage contract', () => {
  it('rolls back the complete health search batch on a later row failure', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const row = {
      source: 'alpha',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 0,
      errorCount: 0,
      latencyMsSum: 10,
      latencySamples: 1,
    };
    await storage.recordSourceHealthSearchBatch([row]);
    const broken = {
      ...row,
      get source(): string {
        throw new Error('batch failure');
      },
    };
    await expect(
      storage.recordSourceHealthSearchBatch([
        row,
        { ...row, source: 'beta' },
        broken,
      ]),
    ).rejects.toThrow('batch failure');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([
      row,
    ]);
  });

  it('accumulates health search rows, normalizes counters and retains date boundaries', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const row = {
      source: 'alpha',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 2,
      errorCount: 3,
      latencyMsSum: 12.5,
      latencySamples: 3,
    };
    await storage.recordSourceHealthSearchBatch([]);
    await storage.recordSourceHealthSearchBatch([
      { ...row, source: 'zeta', bucketDate: '2026-01-03' },
      { ...row, source: 'beta' },
      { ...row, bucketDate: '2026-01-01' },
      { ...row, source: ' alpha ' },
      row,
      { ...row, source: ' ' },
      {
        ...row,
        source: ' ' + 'x'.repeat(200) + ' ',
        okCount: NaN,
        emptyCount: Infinity,
        errorCount: -1,
        latencyMsSum: -Infinity,
        latencySamples: -3,
      },
    ]);
    await storage.recordSourceHealthSearchBatch([row]);
    expect(await storage.getSourceHealthSearchDaily('2026-01-02')).toEqual([
      {
        ...row,
        okCount: 3,
        emptyCount: 6,
        errorCount: 9,
        latencyMsSum: 37.5,
        latencySamples: 9,
      },
      { ...row, source: 'beta' },
      {
        ...row,
        source: 'x'.repeat(191),
        okCount: 0,
        emptyCount: 0,
        errorCount: 0,
        latencyMsSum: 0,
        latencySamples: 0,
      },
      { ...row, source: 'zeta', bucketDate: '2026-01-03' },
    ]);
    await storage.purgeSourceHealthBefore('2026-01-02');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toHaveLength(
      4,
    );
    await storage.purgeSourceHealthBefore('2026-01-04');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([]);
  });

  it('aggregates reporter-days in SQL with success precedence and clears health state', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const report = {
      source: ' alpha ',
      bucketDate: '2026-01-02',
      reporter: 'a',
      success: false,
    };
    for (const success of [false, false, true, true, false])
      await storage.recordSourcePlayReport({ ...report, success });
    for (let i = 0; i < 3; i++)
      await storage.recordSourcePlayReport({ ...report, reporter: 'b' });
    await storage.recordSourcePlayReport({
      ...report,
      bucketDate: '2026-01-03',
      success: true,
    });
    await storage.recordSourcePlayReport({
      ...report,
      bucketDate: '2026-01-01',
      success: true,
    });
    await storage.recordSourcePlayReport({ ...report, source: 'beta' });
    const summaries = [
      {
        source: 'alpha',
        successReporterDays: 2,
        failureReporterDays: 1,
        lastSuccessDate: '2026-01-03',
      },
      {
        source: 'beta',
        successReporterDays: 0,
        failureReporterDays: 1,
        lastSuccessDate: null,
      },
    ];
    expect(await storage.getSourcePlayReporterSummary('2026-01-02')).toEqual(
      summaries,
    );
    await storage.purgeSourceHealthBefore('2026-01-02');
    expect(await storage.getSourcePlayReporterSummary('2026-01-01')).toEqual(
      summaries,
    );
    expect(await storage.getSourcePlayReporterSummary('2026-01-04')).toEqual(
      [],
    );
    await storage.purgeSourceHealthBefore('2026-01-04');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([]);
    expect(await storage.getSourcePlayReporterSummary('2026-01-01')).toEqual(
      [],
    );
  });

  it('stores subscription and live counts outside config and fences stale subscription updates', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const source = {
      key: 'live',
      name: 'Live',
      url: 'https://example.com/live',
      from: 'custom' as const,
    };
    const config = {
      UserConfig: {},
      SourceConfig: [],
      LiveConfig: [source],
    } as unknown as AdminConfig;
    await storage.setAdminConfig(config);
    const expected = await storage.getConfigSubscription();
    const next = {
      ConfigFile: '{}',
      ConfigSubscribtion: {
        URL: 'https://example.com/sub',
        AutoUpdate: true,
        LastCheck: 'now',
      },
    };
    expect(
      await storage.compareAndSetAdminConfig(config, config, {
        subscription: { expected, next },
        liveCounts: { live: 5 },
      }),
    ).toBe(true);
    expect(await storage.getConfigSubscription()).toEqual(next);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 5 });
    expect(
      await storage.compareAndSetAdminConfig(config, config, {
        subscription: { expected, next: expected },
      }),
    ).toBe(false);
    await storage.setLiveSourceChannelCount(source, 10);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 10 });
    expect(await storage.getAdminConfig()).toEqual(config);
    await storage.compareAndSetAdminConfig(config, {
      ...config,
      LiveConfig: [],
    });
    expect(await storage.getLiveSourceChannelCounts()).toEqual({});
  });

  it('原子占用邀请码名额，超出上限即失败', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'LIMITED',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 2,
      usedCount: 0,
    });

    await expect(storage.reserveInviteCodeUse('LIMITED')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('LIMITED')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('LIMITED')).resolves.toBe(false);
    await expect(storage.getAllInviteCodeUsage()).resolves.toMatchObject({
      LIMITED: 2,
    });
  });

  it('maxUses 为 0 表示不限次数', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'FREE',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 0,
      usedCount: 0,
    });

    await expect(storage.reserveInviteCodeUse('FREE')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('FREE')).resolves.toBe(true);
    await expect(storage.getAllInviteCodeUsage()).resolves.toMatchObject({
      FREE: 2,
    });
  });

  it('首次占用以配置里的历史用量为种子', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'SEEDED',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 3,
      usedCount: 2,
    });

    await expect(storage.reserveInviteCodeUse('SEEDED')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('SEEDED')).resolves.toBe(false);
    await expect(storage.getAllInviteCodeUsage()).resolves.toMatchObject({
      SEEDED: 3,
    });
  });

  it('回滚邀请码次数且不会减到负数', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'ROLLBACK',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 2,
      usedCount: 0,
    });

    await storage.reserveInviteCodeUse('ROLLBACK');
    await storage.releaseInviteCodeUse('ROLLBACK');
    await expect(storage.getAllInviteCodeUsage()).resolves.toMatchObject({
      ROLLBACK: 0,
    });

    await storage.releaseInviteCodeUse('ROLLBACK');
    await expect(storage.getAllInviteCodeUsage()).resolves.toMatchObject({
      ROLLBACK: 0,
    });
  });

  it('删除邀请码用量后重建从零开始', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'RECREATED',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 1,
      usedCount: 0,
    });

    await storage.reserveInviteCodeUse('RECREATED');
    await storage.deleteInviteCodeUsage('RECREATED');

    await expect(
      (await storage.getAllInviteCodeUsage()).RECREATED,
    ).toBeUndefined();
    await storage.createInviteCode({
      code: 'RECREATED',
      createdAt: 2,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 1,
    });
    await expect(storage.reserveInviteCodeUse('RECREATED')).resolves.toBe(true);
  });

  it('persists user scoped data and deletes it with the user', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.registerUser('demo-user', 'password');
    await storage.setPlayRecord('demo-user', 'source+1', playRecord);
    await storage.setFavorite('demo-user', 'source+1', favorite);
    await storage.setSkipConfig('demo-user', 'source', '1', skipConfig);
    await storage.setPlaybackSession('demo-user', playbackSession);
    await storage.addSearchHistory('demo-user', 'first');
    await storage.setUserMessageState('demo-user', {
      announcementReadIds: ['announcement:5000:v1'],
    });
    await storage.setDanmakuEnabledPreference('demo-user', true);
    await storage.recordUserLogin('demo-user', 1700000000000);
    await storage.addSearchHistory('demo-user', 'second');
    await storage.addSearchHistory('demo-user', 'first');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(true);
    await expect(
      storage.getPlayRecord('demo-user', 'source+1'),
    ).resolves.toEqual(playRecord);
    await expect(storage.getFavorite('demo-user', 'source+1')).resolves.toEqual(
      favorite,
    );
    await expect(
      storage.getSkipConfig('demo-user', 'source', '1'),
    ).resolves.toEqual(skipConfig);
    await expect(
      storage.getPlaybackPeriodSessions(
        'demo-user',
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        source: playbackSession.source,
        watch_seconds: playbackSession.watch_seconds,
      }),
    ]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({
      announcementReadIds: ['announcement:5000:v1'],
    });
    await storage.updateUserMessageState('demo-user', {
      announcementReadAt: 5000,
    });
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({
      announcementReadAt: 5000,
      announcementReadIds: [],
    });
    await expect(
      storage.getDanmakuEnabledPreference('demo-user'),
    ).resolves.toBe(true);
    await expect(
      storage.getDanmakuEnabledPreference('other-user'),
    ).resolves.toBeNull();
    await expect(storage.getUserLastLogin('demo-user')).resolves.toBe(
      1700000000000,
    );
    await expect(storage.getAllUserLastLogins()).resolves.toEqual({
      'demo-user': 1700000000000,
    });

    await storage.deleteUser('demo-user');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(false);
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({});
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({});
    await expect(
      storage.getPlaybackPeriodSessions(
        'demo-user',
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toEqual([]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({});
    await expect(
      storage.getDanmakuEnabledPreference('demo-user'),
    ).resolves.toBeNull();
    await expect(storage.getUserLastLogin('demo-user')).resolves.toBeNull();
    await expect(storage.getAllUserLastLogins()).resolves.toEqual({});
  });

  it('筛选分页与追更计数及客户端判定保持一致', async () => {
    await assertUpdatedPlayRecordPage(
      new MySqlStorage('mysql://demo:demo@localhost:3306/icetv'),
    );
  });

  it('批量删除隔离用户并同步影响追更计数', async () => {
    await assertBatchDeletePlayRecords(
      new MySqlStorage('mysql://demo:demo@localhost:3306/icetv'),
    );
  });

  it('paginates play records by save time', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.setPlayRecord('demo-user', 'source+old', {
      ...playRecord,
      save_time: 1000,
    });
    await storage.setPlayRecord('demo-user', 'source+middle', {
      ...playRecord,
      save_time: 2000,
    });
    await storage.setPlayRecord('demo-user', 'source+new', {
      ...playRecord,
      save_time: 3000,
    });

    const firstPage = await storage.getPlayRecordPage('demo-user', 2);
    const secondPage = await storage.getPlayRecordPage(
      'demo-user',
      2,
      2000,
      'source+middle',
    );

    expect(Object.keys(firstPage.items)).toEqual([
      'source+new',
      'source+middle',
    ]);
    expect(firstPage).toMatchObject({
      total: 3,
      nextCursor: '2000|source+middle',
    });
    expect(Object.keys(secondPage.items)).toEqual(['source+old']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('按主键游标分页读取过期元数据并排除新鲜项与直播收藏', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const now = 10_000;
    const ttlMs = 1_000;

    await storage.setPlayRecords('metadata-user', {
      'source+a': { ...playRecord, metadata_checked_at: 9_500 },
      'source+b': { ...playRecord, metadata_checked_at: 8_000 },
      'source+c': { ...playRecord },
      'source+d': { ...playRecord, metadata_checked_at: now + 1 },
      'source+e': {
        ...playRecord,
        metadata_checked_at: 'invalid' as unknown as number,
      },
    });
    await storage.setFavorite('metadata-user', 'source+a', {
      ...favorite,
      metadata_checked_at: 9_500,
    });
    await storage.setFavorite('metadata-user', 'source+b', {
      ...favorite,
      metadata_checked_at: 8_000,
    });
    await storage.setFavorite('metadata-user', 'source-live', {
      ...favorite,
      origin: 'live',
    });

    const firstRecords = await storage.getStalePlayRecordPage(
      'metadata-user',
      now,
      ttlMs,
      2,
    );
    const secondRecords = await storage.getStalePlayRecordPage(
      'metadata-user',
      now,
      ttlMs,
      2,
      firstRecords.nextCursor || undefined,
    );
    const favorites = await storage.getStaleFavoritePage(
      'metadata-user',
      now,
      ttlMs,
      10,
    );

    expect(firstRecords.items.map(({ key }) => key)).toEqual([
      'source+b',
      'source+c',
    ]);
    expect(secondRecords.items.map(({ key }) => key)).toEqual([
      'source+d',
      'source+e',
    ]);
    expect(secondRecords.nextCursor).toBeNull();
    expect(favorites.items.map(({ key }) => key)).toEqual(['source+b']);
  });

  it('按原始 JSON 快照进行播放记录与收藏 CAS', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const staleRecord = {
      ...playRecord,
      metadata_checked_at: 1,
    };
    const staleFavorite = {
      ...favorite,
      metadata_checked_at: 1,
    };

    await storage.setPlayRecord('cas-user', 'source+record', staleRecord);
    await storage.setFavorite('cas-user', 'source+favorite', staleFavorite);

    const recordPage = await storage.getStalePlayRecordPage(
      'cas-user',
      10_000,
      1_000,
      10,
    );
    const favoritePage = await storage.getStaleFavoritePage(
      'cas-user',
      10_000,
      1_000,
      10,
    );
    const recordSnapshot = recordPage.items[0]?.snapshot;
    const favoriteSnapshot = favoritePage.items[0]?.snapshot;
    expect(recordSnapshot).toBe(JSON.stringify(staleRecord));
    expect(favoriteSnapshot).toBe(JSON.stringify(staleFavorite));

    const refreshedRecord = {
      ...staleRecord,
      cover: 'refreshed-record.jpg',
      metadata_checked_at: 10_000,
    };
    const refreshedFavorite = {
      ...staleFavorite,
      cover: 'refreshed-favorite.jpg',
      metadata_checked_at: 10_000,
    };
    await expect(
      storage.setPlayRecordIfUnchanged(
        'cas-user',
        'source+record',
        refreshedRecord,
        recordSnapshot as string,
      ),
    ).resolves.toBe(true);
    await expect(
      storage.setFavoriteIfUnchanged(
        'cas-user',
        'source+favorite',
        refreshedFavorite,
        favoriteSnapshot as string,
      ),
    ).resolves.toBe(true);

    await expect(
      storage.getPlayRecord('cas-user', 'source+record'),
    ).resolves.toEqual(refreshedRecord);
    await expect(
      storage.getFavorite('cas-user', 'source+favorite'),
    ).resolves.toEqual(refreshedFavorite);

    const concurrentRecord = { ...refreshedRecord, play_time: 99 };
    const concurrentFavorite = { ...refreshedFavorite, title: '用户修改' };
    await storage.setPlayRecord('cas-user', 'source+record', concurrentRecord);
    await storage.setFavorite(
      'cas-user',
      'source+favorite',
      concurrentFavorite,
    );

    await expect(
      storage.setPlayRecordIfUnchanged(
        'cas-user',
        'source+record',
        { ...refreshedRecord, play_time: 1 },
        recordSnapshot as string,
      ),
    ).resolves.toBe(false);
    await expect(
      storage.setFavoriteIfUnchanged(
        'cas-user',
        'source+favorite',
        { ...refreshedFavorite, title: 'cron 覆盖' },
        favoriteSnapshot as string,
      ),
    ).resolves.toBe(false);
    await expect(
      storage.getPlayRecord('cas-user', 'source+record'),
    ).resolves.toEqual(concurrentRecord);
    await expect(
      storage.getFavorite('cas-user', 'source+favorite'),
    ).resolves.toEqual(concurrentFavorite);
  });

  // 以下四个未读追更用例走 fake pool，其筛选复用生产的 hasPlayRecordUpdate
  // 断言范围是筛选与排序语义，不覆盖真实 SQL 谓词（MySQL 比 'false' 字符串、SQLite 比数字 0 的分歧测不出来）
  it('作品状态与显式开关的组合决定追更查询并保留导出字段', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const records: Record<string, PlayRecord> = {};
    const expected: string[] = [];
    for (const series_status of [undefined, 'ongoing', 'ended'] as const) {
      for (const tracking_enabled of [undefined, true, false]) {
        const key = `source+${series_status}-${tracking_enabled}`;
        records[key] = {
          ...playRecord,
          index: 1,
          total_episodes: 12,
          update_baseline_episodes: 10,
          series_status,
          tracking_enabled,
        };
        if (tracking_enabled ?? series_status !== 'ended') expected.push(key);
      }
    }
    await storage.setPlayRecords('status-contract', records);
    const page = await storage.getUnreadTrackingPlayRecordPage(
      'status-contract',
      20,
    );
    expect(Object.keys(page.items).sort()).toEqual(expected.sort());
    expect(page.total).toBe(expected.length);
    expect(await storage.getAllPlayRecords('status-contract')).toEqual(records);
  });

  it('只返回未读且未关闭追更的记录', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const makeRecord = (
      detectedAt: number,
      total: number,
      baseline: number,
    ) => ({
      ...playRecord,
      index: 1,
      total_episodes: total,
      save_time: detectedAt,
      metadata_checked_at: detectedAt,
      update_baseline_episodes: baseline,
      tracking_enabled: true,
    });

    await storage.setPlayRecords('tracking-filter-user', {
      'source+new': makeRecord(30, 12, 10),
      'source+read': makeRecord(20, 10, 10),
      'source+disabled': {
        ...makeRecord(40, 20, 10),
        tracking_enabled: false,
      },
      'source+finished': {
        ...makeRecord(50, 12, 10),
        index: 12,
      },
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(
      'tracking-filter-user',
      5,
    );

    expect(Object.keys(page.items)).toEqual(['source+new']);
    expect(page.total).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  it('按检测时间倒序翻页并保持 total 为总未读数', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const makeRecord = (detectedAt: number) => ({
      ...playRecord,
      index: 1,
      total_episodes: 12,
      save_time: detectedAt,
      update_detected_at: detectedAt,
      update_baseline_episodes: 10,
      tracking_enabled: true,
    });

    await storage.setPlayRecords('tracking-page-user', {
      'source+old': makeRecord(1000),
      'source+middle': makeRecord(2000),
      'source+new': makeRecord(3000),
    });

    const firstPage = await storage.getUnreadTrackingPlayRecordPage(
      'tracking-page-user',
      2,
    );
    const secondPage = await storage.getUnreadTrackingPlayRecordPage(
      'tracking-page-user',
      2,
      2000,
      'source+middle',
    );

    expect(Object.keys(firstPage.items)).toEqual([
      'source+new',
      'source+middle',
    ]);
    expect(firstPage).toMatchObject({
      total: 3,
      nextCursor: '2000|source+middle',
    });
    expect(Object.keys(secondPage.items)).toEqual(['source+old']);
    expect(secondPage.total).toBe(3);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('同一检测时间靠 record_key 决胜不漏不重', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const sameTime = (key: string) =>
      [
        key,
        {
          ...playRecord,
          index: 1,
          total_episodes: 12,
          save_time: 2000,
          update_detected_at: 2000,
          update_baseline_episodes: 10,
          tracking_enabled: true,
        },
      ] as const;

    await storage.setPlayRecords(
      'tracking-tie-user',
      Object.fromEntries(
        ['source+a', 'source+b', 'source+c'].map((key) => sameTime(key)),
      ),
    );

    const firstPage = await storage.getUnreadTrackingPlayRecordPage(
      'tracking-tie-user',
      2,
    );
    const secondPage = await storage.getUnreadTrackingPlayRecordPage(
      'tracking-tie-user',
      2,
      2000,
      'source+b',
    );

    expect(Object.keys(firstPage.items)).toEqual(['source+c', 'source+b']);
    expect(firstPage.nextCursor).toBe('2000|source+b');
    expect(Object.keys(secondPage.items)).toEqual(['source+a']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('按分组刻度判定未读', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const groupRecord = {
      ...playRecord,
      index: 1,
      total_episodes: 100,
      group_index: 2,
      group_total: 24,
      save_time: 2000,
      update_detected_at: 2000,
      update_baseline_group_total: 12,
      update_baseline_episodes: 100,
      tracking_enabled: true,
    };

    await storage.setPlayRecords('tracking-group-user', {
      'source+group-unread': groupRecord,
      'source+group-read': {
        ...groupRecord,
        update_baseline_group_total: 24,
      },
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(
      'tracking-group-user',
      5,
    );

    expect(Object.keys(page.items)).toEqual(['source+group-unread']);
    expect(page.total).toBe(1);
  });

  it('按最后更新时间清理过期播放统计会话', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'session_old',
      updated_at: 1000,
    });
    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'session_recent',
      updated_at: 2000,
    });

    await expect(storage.deletePlaybackSessionsBefore(1500)).resolves.toBe(1);
    await expect(
      storage.getPlaybackPeriodSessions(
        'demo-user',
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ watch_seconds: playbackSession.watch_seconds }),
    ]);
  });

  it('历史与桶统计双后端契约', async () => {
    await assertWatchHistoryContract(
      new MySqlStorage('mysql://demo:demo@localhost:3306/icetv'),
    );
  });

  it('reads positive playback sessions in a half-open user-scoped range', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await assertPlaybackPeriodRange(storage);
  });

  it('normalizes usernames before storing and looking them up', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.registerUser(' Alice_User ', 'password');

    await expect(storage.getAllUsers()).resolves.toEqual(['alice_user']);
    await expect(storage.checkUserExist('ALICE_USER')).resolves.toBe(true);
    await expect(storage.verifyUser('ALICE_USER', 'password')).resolves.toBe(
      true,
    );
    await expect(storage.registerUser('alice_user', 'other')).rejects.toThrow();
  });

  it('isolates current route semantics while retaining and purging both versions', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    await storage.recordSourceRouteStat({
      source: 'versioned',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'versioned',
      routeMode: 'server',
      success: false,
      eventAt: Date.UTC(2026, 0, 8),
    });
    for (const mode of ['browser', 'server']) {
      await fakePool.execute(
        'INSERT INTO source_route_stats (source, route_mode, bucket_date, success_count, failure_count, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE success_count = success_count + VALUES(success_count)',
        ['versioned', mode, '2026-01-08', 99, 99, 1],
      );
    }
    expect(await storage.getSourceRouteStats('2026-01-01')).toEqual(
      expect.arrayContaining([
        {
          source: 'versioned',
          routeMode: 'browser',
          successCount: 1,
          failureCount: 0,
        },
        {
          source: 'versioned',
          routeMode: 'server',
          successCount: 0,
          failureCount: 1,
        },
      ]),
    );
    expect(await storage.getSourceRouteStats('2026-01-01')).toHaveLength(2);
    expect(
      (await storage.getAllSourceRouteStatBuckets()).map(
        (row) => row.routeMode,
      ),
    ).toEqual(
      expect.arrayContaining(['browser', 'server', 'browser-v2', 'server-v2']),
    );
    await storage.purgeSourceRouteStatsBefore('2026-01-08');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(4);
    await storage.purgeSourceRouteStatsBefore('2026-01-09');
    expect(await storage.getAllSourceRouteStatBuckets()).toEqual([]);
  });

  it('aggregates source route stats by date and mode', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'browser',
      success: false,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'server',
      success: true,
      eventAt: Date.UTC(2026, 0, 7),
    });
    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2025, 11, 31),
    });
    await storage.recordSourceRouteStat({
      source: 'source-b',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });

    const stats = await storage.getSourceRouteStats('2026-01-02');
    await storage.purgeSourceRouteStatsBefore('2026-01-07');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(3);
    expect(await storage.getSourceRouteStats('2025-01-01')).toEqual(stats);
    await storage.purgeSourceRouteStatsBefore('2026-01-08');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(2);
    await storage.purgeSourceRouteStatsBefore('2026-01-09');
    expect(await storage.getAllSourceRouteStatBuckets()).toEqual([]);

    expect(sortRouteStats(stats)).toEqual([
      {
        source: 'source-a',
        routeMode: 'browser',
        successCount: 1,
        failureCount: 1,
      },
      {
        source: 'source-a',
        routeMode: 'server',
        successCount: 1,
        failureCount: 0,
      },
      {
        source: 'source-b',
        routeMode: 'browser',
        successCount: 1,
        failureCount: 0,
      },
    ]);
  });
});

describe('mysql video review contract', () => {
  videoReviewContract(
    () => new MySqlStorage('mysql://demo:demo@localhost:3306/icetv'),
  );
});

describe('mysql user danmaku contract', () => {
  userDanmakuContract(
    () => new MySqlStorage('mysql://demo:demo@localhost:3306/icetv'),
  );
});

describe('MySQL OAuth 身份契约（fake pool）', () => {
  oauthIdentityContract(
    () => new MySqlStorage('mysql://demo:demo@localhost:3306/icetv'),
  );
});

describe('MySQL announcements (fake pool)', () => {
  announcementContract(
    () => new MySqlStorage('mysql://root:password@localhost:3306/icetv'),
  );
});
