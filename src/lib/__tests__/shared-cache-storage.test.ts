/** @jest-environment node */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import { MySqlStorage } from '@/lib/mysql.db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { IStorage } from '@/lib/types';

function contract(
  create: () => IStorage,
  close: (storage: IStorage) => Promise<void>,
) {
  let storage: IStorage;
  beforeAll(() => {
    storage = create();
  });
  afterAll(async () => {
    await close(storage);
  });

  it('atomically admits one lease owner and fences old owners', async () => {
    const key = randomUUID();
    const leases = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        storage.acquireSharedCacheLease(key, String(index), 1000, 2000),
      ),
    );
    expect(leases.filter(Boolean)).toHaveLength(1);
    const owner = String(leases.indexOf(true));
    expect(await storage.renewSharedCacheLease(key, owner, 1100, 3000)).toBe(
      true,
    );
    expect(await storage.acquireSharedCacheLease(key, 'next', 2100, 3100)).toBe(
      false,
    );
    expect(await storage.acquireSharedCacheLease(key, 'next', 3001, 4000)).toBe(
      true,
    );
    expect(
      await storage.setSharedCache(key, owner, 'wrong', 5000, 6000, 3100),
    ).toBe(false);
    await storage.releaseSharedCacheLease(key, owner);
    expect(
      await storage.setSharedCache(key, 'next', 'value', 5000, 6000, 3200),
    ).toBe(true);
    expect(await storage.getSharedCache(key)).toEqual({
      value: 'value',
      freshUntil: 5000,
      staleUntil: 6000,
      leaseUntil: 0,
    });
  });

  it('successful persistence clears the lease without a separate release', async () => {
    const key = randomUUID();
    expect(
      await storage.acquireSharedCacheLease(key, 'writer', 1000, 30_000),
    ).toBe(true);
    expect(
      await storage.setSharedCache(key, 'writer', 'value', 2000, 3000, 1100),
    ).toBe(true);
    expect(
      await storage.renewSharedCacheLease(key, 'writer', 1200, 40_000),
    ).toBe(false);
    expect(
      await storage.acquireSharedCacheLease(key, 'next', 1200, 40_000),
    ).toBe(true);
    expect(
      await storage.setSharedCache(key, 'writer', 'late', 4000, 5000, 1300),
    ).toBe(false);
    expect((await storage.getSharedCache(key))?.value).toBe('value');
    await storage.releaseSharedCacheLease(key, 'next');
  });

  it("deletes only the releasing owner's empty placeholder", async () => {
    const key = randomUUID();
    await storage.acquireSharedCacheLease(key, 'old', 1000, 2000);
    await storage.acquireSharedCacheLease(key, 'next', 2000, 3000);
    await storage.releaseSharedCacheLease(key, 'old');
    expect(await storage.getSharedCache(key)).toMatchObject({
      leaseUntil: 3000,
    });
    await storage.releaseSharedCacheLease(key, 'next');
    expect(await storage.getSharedCache(key)).toBeNull();
    expect(
      await storage.acquireSharedCacheLease(key, 'retry', 2100, 3100),
    ).toBe(true);
    await storage.releaseSharedCacheLease(key, 'retry');
    expect(await storage.getSharedCache(key)).toBeNull();
  });

  it.each(['old value', ' ', ''])(
    'preserves previously written values on release: %j',
    async (value) => {
      const key = randomUUID();
      await storage.acquireSharedCacheLease(key, 'writer', 1000, 2000);
      await storage.setSharedCache(key, 'writer', value, 2000, 4000, 1100);
      await storage.acquireSharedCacheLease(key, 'refresh', 2500, 3500);
      await storage.releaseSharedCacheLease(key, 'refresh');
      expect(await storage.getSharedCache(key)).toEqual({
        value,
        freshUntil: 2000,
        staleUntil: 4000,
        leaseUntil: 0,
      });
    },
  );

  it('prunes expired rows without removing active leases', async () => {
    const expired = randomUUID();
    const active = randomUUID();
    await storage.acquireSharedCacheLease(expired, 'owner', 1000, 2000);
    await storage.setSharedCache(expired, 'owner', 'value', 2000, 3000, 1100);
    await storage.acquireSharedCacheLease(active, 'owner', 1000, 6000);
    await storage.pruneSharedCache(4000, 1000);
    expect(await storage.getSharedCache(expired)).toBeNull();
    expect(await storage.getSharedCache(active)).not.toBeNull();
  });
}

describe('SQLite shared cache storage', () => {
  contract(
    () => new LocalSqliteStorage(':memory:'),
    async (storage) => {
      (storage as unknown as { db: Database.Database }).db.close();
    },
  );
});

const mysqlSuite = process.env.MYSQL_TEST_URL ? describe : describe.skip;
mysqlSuite('MySQL shared cache storage (real SQL)', () => {
  contract(
    () => new MySqlStorage(process.env.MYSQL_TEST_URL),
    async (storage) => {
      await (
        storage as unknown as { pool: { end(): Promise<void> } }
      ).pool.end();
    },
  );
});
