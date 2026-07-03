/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

type SearchHistoryRow = {
  username: string;
  keyword: string;
  sortIndex: number;
};

type FakeState = {
  users: Map<string, string>;
  playRecords: Map<string, Map<string, string>>;
  favorites: Map<string, Map<string, string>>;
  skipConfigs: Map<string, Map<string, string>>;
  searchHistory: SearchHistoryRow[];
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
    searchHistory: state.searchHistory.map((row) => ({ ...row })),
    adminConfig: state.adminConfig,
  };
}

function createState(): FakeState {
  return {
    users: new Map(),
    playRecords: new Map(),
    favorites: new Map(),
    skipConfigs: new Map(),
    searchHistory: [],
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
      normalized === 'SELECT password FROM users WHERE username = ? LIMIT 1'
    ) {
      const [username] = params as [string];
      return [[{ password: currentState.users.get(username) }], []];
    }

    if (normalized === 'SELECT 1 AS v FROM users WHERE username = ? LIMIT 1') {
      const [username] = params as [string];
      return [currentState.users.has(username) ? [{ v: 1 }] : [], []];
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
import type { Favorite, PlayRecord, SkipConfig } from '../types';

const adminConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    AutoSwitchSourceOnTimeout: false,
    LiveDirectConnect: false,
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

describe('mysql storage contract', () => {
  it('persists user scoped data and deletes it with the user', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.registerUser('demo-user', 'password');
    await storage.setPlayRecord('demo-user', 'source+1', playRecord);
    await storage.setFavorite('demo-user', 'source+1', favorite);
    await storage.setSkipConfig('demo-user', 'source', '1', skipConfig);
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
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);

    await storage.deleteUser('demo-user');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(false);
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({});
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({});
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([]);
  });

  it('replaces all data from an import snapshot', async () => {
    const storage = new MySqlStorage('mysql://demo:demo@localhost:3306/icetv');

    await storage.replaceAllData({
      adminConfig,
      users: {
        'demo-user':
          '$2b$10$abcdefghijklmnopqrstuu9dBwFh6R0D4A5gHfHnM6kQ7xS8tT9u',
      },
      userData: {
        'demo-user': {
          playRecords: { 'source+1': playRecord },
          favorites: { 'source+1': favorite },
          searchHistory: ['first', 'second'],
          skipConfigs: { 'source+1': skipConfig },
        },
      },
    });

    await expect(storage.getAdminConfig()).resolves.toEqual(adminConfig);
    await expect(storage.getAllUsers()).resolves.toEqual(['demo-user']);
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
  });
});
