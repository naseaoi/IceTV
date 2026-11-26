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

  it('在线备份包含 WAL 中的已提交数据且原连接继续可用', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'icetv-online-backup-'));
    const storage = new LocalSqliteStorage(join(directory, 'test.sqlite'));
    let snapshot: Database.Database | undefined;
    try {
      await storage.registerUser('backup-user', 'password');
      const destination = await storage.backup('icetv-data-test-1000.sqlite');
      expect(destination).toBe(
        join(directory, 'backups', 'icetv-data-test-1000.sqlite'),
      );
      snapshot = new Database(destination, { readonly: true });
      expect(
        snapshot
          .prepare('SELECT username FROM users WHERE username = ?')
          .get('backup-user'),
      ).toEqual({ username: 'backup-user' });
      await storage.registerUser('after-backup', 'password');
      expect(await storage.checkUserExist('after-backup')).toBe(true);
      expect(
        snapshot
          .prepare('SELECT username FROM users WHERE username = ?')
          .get('after-backup'),
      ).toBeUndefined();
    } finally {
      snapshot?.close();
      (storage as unknown as { db: Database.Database }).db.close();
      rmSync(directory, { recursive: true, force: true });
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

  it('新装表带密码状态，第三方首次设密与普通账号校验在重新初始化后保持', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'icetv-oauth-password-'));
    const path = join(dir, 'test.db');
    let storage: LocalSqliteStorage | undefined;
    const close = () =>
      (storage as unknown as { db: Database.Database } | undefined)?.db.close();
    try {
      storage = new LocalSqliteStorage(path);
      const raw = (storage as unknown as { db: Database.Database }).db;
      expect(raw.prepare('PRAGMA table_info(users)').all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'password_set',
            notnull: 1,
            dflt_value: '1',
          }),
        ]),
      );
      await storage.registerUser(
        'legacy',
        'random-password',
        undefined,
        undefined,
        {
          provider: 'linuxdo',
          providerUserId: 'legacy',
          username: 'legacy',
          providerUsername: 'Legacy',
          autoCreated: true,
          createdAt: Date.now(),
        },
      );
      await storage.registerUser('bound', 'existing-password');
      await storage.bindOAuthIdentity({
        provider: 'linuxdo',
        providerUserId: 'bound',
        username: 'bound',
        providerUsername: 'Bound',
        autoCreated: false,
        createdAt: Date.now(),
      });
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
