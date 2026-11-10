/** @jest-environment node */

import type Database from 'better-sqlite3';

import { IMPORT_ADMIN_CONFIG } from '@/lib/__tests__/__fixtures__/import-admin-config';
import { resetMysqlTestData } from '@/lib/__tests__/__fixtures__/mysql-test-data';
import { configSelfCheck } from '@/lib/config';
import { stripConfigState, subscriptionFromConfig } from '@/lib/config-state';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteConfigStateStore } from '@/lib/sqlite-config-state-store';
import type { AdminConfig } from '@/types/admin';

const source = {
  key: 'live',
  name: 'Live',
  url: 'https://example.com/live.m3u',
  from: 'custom' as const,
};
function legacyConfig(): AdminConfig {
  return {
    ...JSON.parse(JSON.stringify(IMPORT_ADMIN_CONFIG)),
    ConfigFile: '{"lives":{}}',
    ConfigSubscribtion: {
      URL: 'https://example.com/config',
      AutoUpdate: true,
      LastCheck: '2026-01-01',
    },
    LiveConfig: [{ ...source, channelNumber: 12 }],
  };
}

async function assertSubscriptionFailureState(
  storage: Pick<
    LocalSqliteStorage,
    'setAdminConfig' | 'getConfigSubscription' | 'compareAndSetAdminConfig'
  >,
) {
  const config = stripConfigState(legacyConfig());
  await storage.setAdminConfig(config);
  const expected = await storage.getConfigSubscription();
  const failed = {
    ...expected,
    ConfigSubscribtion: {
      ...expected.ConfigSubscribtion,
      FailureSince: '2026-11-10T00:00:00Z',
    },
  };
  expect(
    await storage.compareAndSetAdminConfig(config, config, {
      subscription: { expected, next: failed },
    }),
  ).toBe(true);
  expect(await storage.getConfigSubscription()).toEqual(failed);
  expect(
    await storage.compareAndSetAdminConfig(config, config, {
      subscription: { expected, next: expected },
    }),
  ).toBe(false);
  expect(
    await storage.compareAndSetAdminConfig(config, config, {
      subscription: { expected: failed, next: expected },
    }),
  ).toBe(true);
  expect(
    (await storage.getConfigSubscription()).ConfigSubscribtion.FailureSince,
  ).toBeUndefined();
}

describe('config state storage', () => {
  let storage: LocalSqliteStorage;
  let raw: Database.Database;
  beforeEach(() => {
    storage = new LocalSqliteStorage(':memory:');
    raw = (storage as unknown as { db: Database.Database }).db;
  });
  afterEach(() => raw.close());

  it('migrates legacy fields once and preserves newer table state', async () => {
    const legacy = legacyConfig();
    await storage.setAdminConfig(legacy);
    const state = new SqliteConfigStateStore(raw);
    state.migrate();
    expect(await storage.getConfigSubscription()).toEqual(
      subscriptionFromConfig(legacy),
    );
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 12 });
    expect(await storage.getAdminConfig()).toEqual(
      stripConfigState(JSON.parse(JSON.stringify(legacy))),
    );
    state.saveSubscription({
      ...subscriptionFromConfig(legacy),
      ConfigFile: 'new',
    });
    state.setCount('live', 99);
    state.migrate();
    await storage.setAdminConfig(legacy);
    state.migrate();
    expect((await storage.getConfigSubscription()).ConfigFile).toBe('new');
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 99 });
  });

  it('rolls back both tables when migration CAS fails', async () => {
    await storage.setAdminConfig(legacyConfig());
    raw.exec(
      "CREATE TRIGGER reject_config BEFORE UPDATE ON admin_config BEGIN SELECT RAISE(ABORT, 'conflict'); END",
    );
    expect(() => new SqliteConfigStateStore(raw).migrate()).toThrow('conflict');
    expect(await storage.getLiveSourceChannelCounts()).toEqual({});
    expect((await storage.getConfigSubscription()).ConfigFile).toBe('');
  });

  it('updates counts without touching config and rejects late refreshes after deletion or URL edits', async () => {
    const config = stripConfigState(legacyConfig());
    await storage.setAdminConfig(config);
    raw.exec(
      "CREATE TRIGGER reject_config BEFORE UPDATE ON admin_config BEGIN SELECT RAISE(ABORT, 'unexpected config write'); END",
    );
    await storage.setLiveSourceChannelCount(source, 42);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 42 });
    raw.exec('DROP TRIGGER reject_config');
    const edited = {
      ...config,
      LiveConfig: [{ ...source, url: 'https://example.com/new.m3u' }],
    };
    await storage.compareAndSetAdminConfig(config, edited);
    await storage.setLiveSourceChannelCount(source, 100);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 42 });
    await storage.compareAndSetAdminConfig(edited, {
      ...edited,
      LiveConfig: [],
    });
    await storage.setLiveSourceChannelCount(source, 200);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({});
  });

  it('commits subscription and config atomically, detects subscription-only conflicts, and skips unchanged JSON', async () => {
    const config = stripConfigState(legacyConfig());
    await storage.setAdminConfig(config);
    const expected = await storage.getConfigSubscription();
    const next = subscriptionFromConfig(legacyConfig());
    raw.exec(
      "CREATE TRIGGER reject_config BEFORE UPDATE ON admin_config BEGIN SELECT RAISE(ABORT, 'unexpected config write'); END",
    );
    expect(
      await storage.compareAndSetAdminConfig(config, config, {
        subscription: { expected, next },
      }),
    ).toBe(true);
    expect(
      await storage.compareAndSetAdminConfig(config, config, {
        subscription: { expected, next: expected },
        liveCounts: { live: 8 },
      }),
    ).toBe(false);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({});
    expect(await storage.getConfigSubscription()).toEqual(next);
  });

  it('round trips failure state and fences stale successful refreshes', async () => {
    await assertSubscriptionFailureState(storage);
  });

  it('runtime self-check strips compatibility fields', () => {
    const config = configSelfCheck(legacyConfig());
    expect(config.ConfigFile).toBeUndefined();
    expect(config.ConfigSubscribtion).toBeUndefined();
    expect(config.LiveConfig?.[0].channelNumber).toBeUndefined();
  });
});

const mysqlSuite = process.env.MYSQL_TEST_URL ? describe : describe.skip;
mysqlSuite('MySQL config state storage (real SQL)', () => {
  let storage: import('@/lib/mysql.db').MySqlStorage;
  let pool: import('mysql2/promise').Pool;
  beforeAll(async () => {
    const { MySqlStorage } = await import('@/lib/mysql.db');
    storage = new MySqlStorage(process.env.MYSQL_TEST_URL);
    pool = (storage as unknown as { pool: import('mysql2/promise').Pool }).pool;
    await storage.getAdminConfig();
  });
  afterAll(async () => pool.end());

  it('round trips failure state and fences stale successful refreshes', async () => {
    await resetMysqlTestData(storage);
    await assertSubscriptionFailureState(storage);
  });

  it('migrates idempotently and fences concurrent subscription/config writes', async () => {
    const { MysqlConfigStateStore } =
      await import('@/lib/mysql-config-state-store');
    await resetMysqlTestData(storage);
    const legacy = legacyConfig();
    await storage.setAdminConfig(legacy);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await new MysqlConfigStateStore(connection).migrate();
      await new MysqlConfigStateStore(connection).migrate();
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    expect(await storage.getConfigSubscription()).toEqual(
      subscriptionFromConfig(legacy),
    );
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 12 });
    const config = (await storage.getAdminConfig())!;
    expect(config.ConfigFile).toBeUndefined();
    expect(config.LiveConfig?.[0].channelNumber).toBeUndefined();
    const expected = await storage.getConfigSubscription();
    const results = await Promise.all(
      [1, 2].map((index) =>
        storage.compareAndSetAdminConfig(config, config, {
          subscription: {
            expected,
            next: { ...expected, ConfigFile: String(index) },
          },
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await storage.setLiveSourceChannelCount(source, 55);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({ live: 55 });
    expect(await storage.getAdminConfig()).toEqual(config);
    await storage.compareAndSetAdminConfig(config, {
      ...config,
      LiveConfig: [],
    });
    await storage.setLiveSourceChannelCount(source, 99);
    expect(await storage.getLiveSourceChannelCounts()).toEqual({});
  });
});

it('LinuxDo 设置自检保留合法值并恢复无效默认值', () => {
  const config = legacyConfig();
  config.UserConfig.LinuxDo = { Enabled: true, MinTrustLevel: 4 };
  expect(configSelfCheck(config).UserConfig.LinuxDo).toEqual({
    Enabled: true,
    MinTrustLevel: 4,
  });
  config.UserConfig.LinuxDo = {
    Enabled: 'true',
    MinTrustLevel: 9,
  } as unknown as NonNullable<AdminConfig['UserConfig']['LinuxDo']>;
  config.UserConfig.LinuxDoConfigured = true;
  expect(configSelfCheck(config).UserConfig.LinuxDo).toEqual({
    Enabled: false,
    MinTrustLevel: 1,
  });
  expect(config.UserConfig.LinuxDoConfigured).toBeUndefined();
});

it('分片代理池开关自检保留布尔值并剔除仅响应字段', () => {
  const config = legacyConfig();
  config.SiteConfig.UpstreamProxyPoolSegments = true;
  config.SiteConfig.UpstreamProxyPoolConfigured = true;
  const checked = configSelfCheck(config).SiteConfig;
  expect(checked.UpstreamProxyPoolSegments).toBe(true);
  expect(checked.UpstreamProxyPoolConfigured).toBeUndefined();
  config.SiteConfig.UpstreamProxyPoolSegments = 'on' as unknown as boolean;
  expect(configSelfCheck(config).SiteConfig.UpstreamProxyPoolSegments).toBe(
    false,
  );
});
