/** @jest-environment node */

import Database from 'better-sqlite3';

import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteUserAccessStore } from '@/lib/sqlite-user-access';
import { userAccessSchema } from '@/lib/user-access';
import type { AdminConfig } from '@/types/admin';

const config = {
  SourceConfig: [{ key: 'one' }, { key: 'two' }],
  UserConfig: { Tags: [{ name: 'first' }, { name: 'second' }] },
} as AdminConfig;

describe('user access migration and transactional updates', () => {
  let storage: LocalSqliteStorage;
  let raw: Database.Database;
  beforeEach(() => {
    storage = new LocalSqliteStorage(':memory:');
    raw = (storage as unknown as { db: Database.Database }).db;
  });
  afterEach(() => raw.close());

  it('migrates legacy permissions once, preserves group order, and repairs missing rows', async () => {
    await storage.registerUser('Alice', 'password');
    await storage.registerUser('bob', 'password');
    await storage.setAdminConfig({
      ...config,
      UserConfig: {
        ...config.UserConfig,
        Users: [
          {
            username: ' ALICE ',
            role: 'admin',
            banned: true,
            tags: ['second', 'first'],
            enabledApis: ['one'],
          },
        ],
      },
    });
    const access = new SqliteUserAccessStore(raw);
    access.migrate();
    expect(await storage.getUserAccess('ALICE')).toMatchObject({
      role: 'admin',
      banned: true,
      tags: ['second', 'first'],
      enabledApis: ['one'],
    });
    expect((await storage.getAdminConfig())?.UserConfig.Users).toBeUndefined();
    await storage.updateUserAccess(['alice'], { role: 'user', banned: false });
    raw.prepare('DELETE FROM user_access WHERE username = ?').run('bob');
    access.migrate();
    expect(await storage.getUserAccess('alice')).toMatchObject({
      role: 'user',
      banned: false,
    });
    expect(await storage.getUserAccess('bob')).toMatchObject({
      role: 'user',
      banned: false,
    });
  });

  it('rolls back migration data if config CAS fails', () => {
    raw
      .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
      .run('alice', 'hash');
    raw.prepare('INSERT INTO admin_config (id, config_json) VALUES (1, ?)').run(
      JSON.stringify({
        UserConfig: { Users: [{ username: 'alice', role: 'admin' }] },
      }),
    );
    raw.exec(
      "CREATE TRIGGER reject_config BEFORE UPDATE ON admin_config BEGIN SELECT RAISE(ABORT, 'conflict'); END",
    );
    expect(() => new SqliteUserAccessStore(raw).migrate()).toThrow('conflict');
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM user_access').get(),
    ).toEqual({ count: 0 });
  });

  it('does not authenticate stale metadata without a users row', () => {
    new SqliteUserAccessStore(raw).put({ username: 'deleted', role: 'admin' });
    expect(new SqliteUserAccessStore(raw).get('deleted')).toBeNull();
  });

  it('cleans deleted groups and sources only with successful config CAS', async () => {
    await storage.registerUser('alice', 'password');
    await storage.updateUserAccess(['alice'], {
      tags: ['second', 'first'],
      enabledApis: ['one', 'two'],
    });
    await storage.setAdminConfig(config);
    const next = {
      ...config,
      SourceConfig: [config.SourceConfig[1]],
      UserConfig: { Tags: [config.UserConfig.Tags![1]] },
    };
    expect(
      await storage.compareAndSetAdminConfig(
        { ...config, ConfigFile: 'stale' },
        next,
      ),
    ).toBe(false);
    expect((await storage.getUserAccess('alice'))?.tags).toEqual([
      'second',
      'first',
    ]);
    expect(await storage.compareAndSetAdminConfig(config, next)).toBe(true);
    expect(await storage.getUserAccess('alice')).toMatchObject({
      tags: ['second'],
      enabledApis: ['two'],
    });
  });

  it('rechecks role exemptions inside updates and deletion', async () => {
    await storage.registerUser('alice', 'password');
    await storage.registerUser('bob', 'password');
    await storage.updateUserAccess(['alice'], { role: 'admin' });
    const guard = {
      operatorUsername: 'bob',
      operatorRole: 'admin' as const,
      excludeSelf: true,
    };
    expect(
      await storage.updateUserAccess(['alice', 'bob'], { banned: true }, guard),
    ).toBe(0);
    await expect(storage.deleteUser('alice', guard)).rejects.toThrow(
      '用户权限已变化',
    );
    expect(await storage.deleteUserIfInactive('alice', Date.now(), 'bob')).toBe(
      false,
    );
    await storage.updateUserAccess(['alice'], { role: 'user' });
    expect(await storage.deleteUserIfInactive('alice', Date.now(), 'bob')).toBe(
      true,
    );
    expect(await storage.getUserAccess('alice')).toBeNull();
  });

  it('creates binary indexed tables in both dialects', () => {
    expect(userAccessSchema('mysql').join('\n')).toContain('utf8mb4_bin');
    expect(
      raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_user_%'",
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { name: 'idx_user_access_role' },
        { name: 'idx_user_access_banned' },
        { name: 'idx_user_group_members_group' },
      ]),
    );
  });
});
