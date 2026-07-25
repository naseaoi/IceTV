/** @jest-environment node */

import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import type { AdminConfig } from '@/types/admin';

type SearchHistoryRow = {
  username: string;
  keyword: string;
  sortIndex: number;
};

type SourceRouteStatsRow = {
  source: string;
  routeMode: 'browser' | 'server';
  bucketDate: string;
  successCount: number;
  failureCount: number;
  updatedAt: number;
};

type FakeState = {
  users: Map<string, string>;
  playRecords: Map<string, Map<string, string>>;
  favorites: Map<string, Map<string, string>>;
  skipConfigs: Map<string, Map<string, string>>;
  playbackSessions: Map<string, Record<string, unknown>>;
  searchHistory: SearchHistoryRow[];
  sourceRouteStats: SourceRouteStatsRow[];
  adminConfig: string | null;
};

function cloneNestedMap(source: Map<string, Map<string, string>>) {
  return new Map(
    Array.from(source.entries(), ([key, value]) => [key, new Map(value)]),
  );
}

function cloneState(state: FakeState): FakeState {
  return {
    users: new Map(state.users),
    playRecords: cloneNestedMap(state.playRecords),
    favorites: cloneNestedMap(state.favorites),
    skipConfigs: cloneNestedMap(state.skipConfigs),
    playbackSessions: new Map(state.playbackSessions),
    searchHistory: state.searchHistory.map((row) => ({ ...row })),
    sourceRouteStats: state.sourceRouteStats.map((row) => ({ ...row })),
    adminConfig: state.adminConfig,
  };
}

function createState(): FakeState {
  return {
    users: new Map(),
    playRecords: new Map(),
    favorites: new Map(),
    skipConfigs: new Map(),
    playbackSessions: new Map(),
    searchHistory: [],
    sourceRouteStats: [],
    adminConfig: null,
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

function createFakePool() {
  let state = createState();

  const runExecute = async (
    sql: string,
    params: unknown[] = [],
    currentState: FakeState,
  ) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

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

    if (normalized === 'DELETE FROM users') {
      currentState.users.clear();
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
      'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)'
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.playRecords, username, key, value);
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO favorites (username, favorite_key, favorite_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE favorite_json = VALUES(favorite_json)'
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.favorites, username, key, value);
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO favorites (username, favorite_key, favorite_json) VALUES (?, ?, ?)'
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.favorites, username, key, value);
      return [[], []];
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
      normalized ===
      'INSERT INTO skip_configs (username, config_key, config_json) VALUES (?, ?, ?)'
    ) {
      const [username, key, value] = params as [string, string, string];
      upsertJsonRecord(currentState.skipConfigs, username, key, value);
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

    if (normalized === 'DELETE FROM play_records') {
      currentState.playRecords.clear();
      return [[], []];
    }

    if (normalized === 'DELETE FROM favorites') {
      currentState.favorites.clear();
      return [[], []];
    }

    if (normalized === 'DELETE FROM skip_configs') {
      currentState.skipConfigs.clear();
      return [[], []];
    }

    if (normalized === 'DELETE FROM playback_sessions') {
      currentState.playbackSessions.clear();
      return [[], []];
    }

    if (
      normalized ===
      'INSERT INTO playback_sessions ( id, username, source, video_id, episode_index, title, source_name, cover, year, started_at, ended_at, watch_seconds, last_position, total_time, created_at, updated_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username), source = VALUES(source), video_id = VALUES(video_id), episode_index = VALUES(episode_index), title = VALUES(title), source_name = VALUES(source_name), cover = VALUES(cover), year = VALUES(year), started_at = VALUES(started_at), ended_at = VALUES(ended_at), watch_seconds = VALUES(watch_seconds), last_position = VALUES(last_position), total_time = VALUES(total_time), created_at = VALUES(created_at), updated_at = VALUES(updated_at)'
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
      'INSERT INTO playback_sessions ( id, username, source, video_id, episode_index, title, source_name, cover, year, started_at, ended_at, watch_seconds, last_position, total_time, created_at, updated_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
      'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, ?)'
    ) {
      const [username, keyword, sortIndex] = params as [string, string, number];
      currentState.searchHistory.push({ username, keyword, sortIndex });
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

    if (normalized === 'DELETE FROM search_history') {
      currentState.searchHistory = [];
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

    if (normalized === 'DELETE FROM admin_config') {
      currentState.adminConfig = null;
      return [[], []];
    }

    if (
      normalized.startsWith(
        'INSERT INTO source_route_stats ( source, route_mode, bucket_date, success_count, failure_count, updated_at ) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE',
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
        'browser' | 'server',
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

    if (
      normalized ===
      'INSERT INTO source_route_stats ( source, route_mode, bucket_date, success_count, failure_count, updated_at ) VALUES (?, ?, ?, ?, ?, ?)'
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
        'browser' | 'server',
        string,
        number,
        number,
        number,
      ];
      currentState.sourceRouteStats.push({
        source,
        routeMode,
        bucketDate,
        successCount,
        failureCount,
        updatedAt,
      });
      return [[], []];
    }

    if (normalized === 'DELETE FROM source_route_stats') {
      currentState.sourceRouteStats = [];
      return [[], []];
    }

    throw new Error(`Unhandled execute SQL: ${normalized}`);
  };

  const runQuery = async (
    sql: string,
    params: unknown[] = [],
    currentState: FakeState,
  ) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

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
      normalized ===
      'SELECT username, password FROM users ORDER BY username ASC'
    ) {
      return [
        Array.from(currentState.users.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([username, password]) => ({ username, password })),
        [],
      ];
    }

    if (
      normalized === 'SELECT config_json FROM admin_config WHERE id = 1 LIMIT 1'
    ) {
      return [[{ config_json: currentState.adminConfig }], []];
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
          route_mode: 'browser' | 'server';
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

    throw new Error(`Unhandled query SQL: ${normalized}`);
  };

  return {
    async execute(sql: string, params?: unknown[]) {
      return runExecute(sql, params, state);
    },
    async query(sql: string, params?: unknown[]) {
      return runQuery(sql, params, state);
    },
    async getConnection() {
      let transactionState = cloneState(state);

      return {
        async beginTransaction() {
          transactionState = cloneState(state);
        },
        async commit() {
          state = cloneState(transactionState);
        },
        async rollback() {},
        async execute(sql: string, params?: unknown[]) {
          return runExecute(sql, params, transactionState);
        },
        release() {},
      };
    },
  };
}

const fakePool = createFakePool();

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
} from '../types';

const adminConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    FooterText: '',
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    LiveDirectConnect: false,
    ...DEFAULT_RUNTIME_PARAMS,
    SearchDownstreamMaxPage: 5,
    SiteInterfaceCacheTime: 300,
    DoubanProxyType: 'direct',
    DoubanProxy: '',
    BangumiDataSource: 'server',
    BangumiProxy: '',
    DoubanImageProxyType: 'direct',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
  },
  UserConfig: {
    Users: [],
    OpenRegister: false,
    Tags: [],
  },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

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
  it('persists user scoped data and deletes it with the user', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.registerUser('demo-user', 'password');
    await storage.setPlayRecord('demo-user', 'source+1', playRecord);
    await storage.setFavorite('demo-user', 'source+1', favorite);
    await storage.setSkipConfig('demo-user', 'source', '1', skipConfig);
    await storage.setPlaybackSession('demo-user', playbackSession);
    await storage.addSearchHistory('demo-user', 'first');
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
    await expect(storage.getPlaybackSessions('demo-user')).resolves.toEqual([
      playbackSession,
    ]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);

    await storage.deleteUser('demo-user');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(false);
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({});
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({});
    await expect(storage.getPlaybackSessions('demo-user')).resolves.toEqual([]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([]);
  });

  it('replaces all data from an import snapshot', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');
    const passwordHash =
      '$2b$10$abcdefghijklmnopqrstuu9dBwFh6R0D4A5gHfHnM6kQ7xS8tT9u';

    await storage.replaceAllData({
      adminConfig,
      users: {
        'demo-user': passwordHash,
      },
      userData: {
        'demo-user': {
          playRecords: { 'source+1': playRecord },
          favorites: { 'source+1': favorite },
          searchHistory: ['first', 'second'],
          skipConfigs: { 'source+1': skipConfig },
          playbackSessions: { [playbackSession.id]: playbackSession },
        },
      },
      sourceRouteStats: [
        {
          source: 'source-a',
          routeMode: 'browser',
          bucketDate: '2026-01-08',
          successCount: 3,
          failureCount: 1,
        },
      ],
    });

    await expect(storage.getAdminConfig()).resolves.toEqual(adminConfig);
    await expect(storage.getAllUsers()).resolves.toEqual(['demo-user']);
    await expect(storage.getAllUsersWithPasswords()).resolves.toEqual({
      'demo-user': passwordHash,
    });
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({
      'source+1': playRecord,
    });
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({
      'source+1': favorite,
    });
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({
      'source+1': skipConfig,
    });
    await expect(storage.getPlaybackSessions('demo-user')).resolves.toEqual([
      playbackSession,
    ]);
    await expect(storage.getAllPlaybackSessions('demo-user')).resolves.toEqual([
      playbackSession,
    ]);
    await expect(storage.getAllSourceRouteStatBuckets()).resolves.toEqual([
      {
        source: 'source-a',
        routeMode: 'browser',
        bucketDate: '2026-01-08',
        successCount: 3,
        failureCount: 1,
      },
    ]);
  });

  it('按最后更新时间清理过期播放统计会话', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.clearAllData();
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
    await expect(storage.getAllPlaybackSessions('demo-user')).resolves.toEqual([
      expect.objectContaining({ id: 'session_recent' }),
    ]);
  });

  it('normalizes usernames before storing and looking them up', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.clearAllData();
    await storage.registerUser(' Alice_User ', 'password');

    await expect(storage.getAllUsers()).resolves.toEqual(['alice_user']);
    await expect(storage.checkUserExist('ALICE_USER')).resolves.toBe(true);
    await expect(storage.verifyUser('ALICE_USER', 'password')).resolves.toBe(
      true,
    );
    await expect(storage.registerUser('alice_user', 'other')).rejects.toThrow();
  });

  it('aggregates source route stats by date and mode', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.clearAllData();
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
