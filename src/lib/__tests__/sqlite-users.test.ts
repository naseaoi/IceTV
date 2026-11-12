/** @jest-environment node */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';

import { LocalSqliteStorage } from '../sqlite.db';

installCryptoPolyfill();

describe('sqlite user storage', () => {
  const originalDockerEnv = process.env.DOCKER_ENV;

  beforeEach(() => {
    process.env.DOCKER_ENV = '1';
  });

  afterEach(() => {
    if (originalDockerEnv === undefined) {
      delete process.env.DOCKER_ENV;
    } else {
      process.env.DOCKER_ENV = originalDockerEnv;
    }
  });

  it('keeps the original password when duplicate registration is attempted', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.registerUser('demo-user', 'first-password');
    await expect(
      storage.registerUser('demo-user', 'second-password'),
    ).rejects.toThrow();

    await expect(
      storage.verifyUser('demo-user', 'first-password'),
    ).resolves.toBe(true);
    await expect(
      storage.verifyUser('demo-user', 'second-password'),
    ).resolves.toBe(false);
  });

  it('normalizes usernames before storing and looking them up', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.registerUser(' Alice_User ', 'password');

    await expect(storage.getAllUsers()).resolves.toEqual(['alice_user']);
    await expect(storage.checkUserExist('ALICE_USER')).resolves.toBe(true);
    await expect(storage.verifyUser('ALICE_USER', 'password')).resolves.toBe(
      true,
    );
    await expect(storage.registerUser('alice_user', 'other')).rejects.toThrow();
  });

  it('迁移时第三方自动建号的账号可首次设密，绑定账号保留旧密码校验，重复初始化不覆盖设密状态', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'icetv-oauth-password-'));
    const path = join(dir, 'test.db');
    const raw = new Database(path);
    raw.exec(`CREATE TABLE users (username TEXT PRIMARY KEY, password TEXT NOT NULL);
      INSERT INTO users VALUES ('legacy', 'random-password');
      INSERT INTO users VALUES ('bound', 'existing-password');
      CREATE TABLE oauth_identities (
        provider VARCHAR(32), provider_user_id VARCHAR(191), username VARCHAR(191),
        provider_username VARCHAR(191), auto_created INTEGER, created_at BIGINT,
        PRIMARY KEY(provider, provider_user_id), UNIQUE(provider, username));
      INSERT INTO oauth_identities VALUES ('linuxdo', 'old', 'legacy', 'Legacy', 1, 1);
      INSERT INTO oauth_identities VALUES ('linuxdo', 'kept', 'bound', 'Bound', 0, 1);`);
    raw.close();
    let storage: LocalSqliteStorage | undefined;
    const close = () =>
      (storage as unknown as { db: Database.Database } | undefined)?.db.close();
    try {
      storage = new LocalSqliteStorage(path);
      expect(await storage.isPasswordSet('legacy')).toBe(false);
      expect(await storage.isPasswordSet('bound')).toBe(true);
      expect(
        await storage.changePassword('bound', 'next-password', false, null),
      ).toBe(false);
      expect(await storage.verifyUser('bound', 'existing-password')).toBe(true);
      expect(
        await storage.changePassword('legacy', 'next-password', false, null),
      ).toBe(true);
      expect(await storage.verifyUser('legacy', 'next-password')).toBe(true);
      await storage.registerUser(
        'fresh',
        'random-secret',
        undefined,
        undefined,
        {
          provider: 'linuxdo',
          providerUserId: 'new',
          username: 'fresh',
          providerUsername: 'Fresh',
          autoCreated: true,
          createdAt: Date.now(),
        },
      );
      close();
      storage = undefined;
      storage = new LocalSqliteStorage(path);
      expect(await storage.isPasswordSet('fresh')).toBe(false);
      expect(await storage.isPasswordSet('legacy')).toBe(true);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('并发首次设置只有一个密码生效', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.registerUser('fresh', 'random-secret', undefined, undefined, {
      provider: 'linuxdo',
      providerUserId: 'new',
      username: 'fresh',
      providerUsername: 'Fresh',
      autoCreated: true,
      createdAt: Date.now(),
    });
    const results = await Promise.allSettled([
      storage.changePassword('fresh', 'first-password', false, null),
      storage.changePassword('fresh', 'second-password', false, null),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled' && result.value),
    ).toHaveLength(1);
    const matches = await Promise.all([
      storage.verifyUser('fresh', 'first-password'),
      storage.verifyUser('fresh', 'second-password'),
    ]);
    expect(matches.filter(Boolean)).toHaveLength(1);
  });

  it('rejects invalid and overlong usernames', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await expect(storage.registerUser('bad name', 'password')).rejects.toThrow(
      '用户名只能包含',
    );
    await expect(
      storage.registerUser('a'.repeat(65), 'password'),
    ).rejects.toThrow('用户名只能包含');
  });
});
