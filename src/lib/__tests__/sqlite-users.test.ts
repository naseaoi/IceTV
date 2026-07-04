/** @jest-environment node */

import { LocalSqliteStorage } from '../sqlite.db';

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
