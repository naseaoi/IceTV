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
});
