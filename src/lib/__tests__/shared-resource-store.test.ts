/** @jest-environment node */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MySqlStorage } from '@/lib/mysql.db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { IStorage } from '@/lib/types';

function contract(
  create: () => IStorage[],
  close: (stores: IStorage[]) => Promise<void>,
) {
  let stores: IStorage[];
  beforeAll(() => {
    stores = create();
  });
  afterAll(async () => {
    await close(stores);
  });

  it('shares an atomic rate window across connections and resets it', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        stores[index % stores.length].resources.consume(
          key,
          1,
          10,
          60_000,
          1000,
        ),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(
      (await stores[0].resources.consume(key, 1, 10, 60_000, 2000))
        .retryAfterMs,
    ).toBe(59000);
    expect(
      (await stores[1].resources.consume(key, 10, 10, 60_000, 61_000)).allowed,
    ).toBe(true);
  });

  it('caps shared connections and fences expired owners', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        stores[index % stores.length].resources.acquire(
          key,
          String(index),
          4,
          1000,
          2000,
        ),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(4);
    const owner = String(results.findIndex((result) => result.allowed));
    expect(await stores[1].resources.renew(key, owner, 1500, 4000)).toBe(true);
    await stores[0].resources.prune(2100);
    expect(
      (await stores[1].resources.acquire(key, 'next', 1, 2100, 3000)).allowed,
    ).toBe(false);
    expect(
      (await stores[1].resources.acquire(key, 'next', 1, 4100, 5000)).allowed,
    ).toBe(true);
    await stores[0].resources.release(key, owner);
    expect(await stores[0].resources.renew(key, owner, 4100, 6000)).toBe(false);
    expect(
      (await stores[0].resources.acquire(key, 'blocked', 1, 4200, 5200))
        .allowed,
    ).toBe(false);
    await stores[1].resources.release(key, 'next');
    expect(
      (await stores[0].resources.acquire(key, 'released', 1, 4200, 5200))
        .allowed,
    ).toBe(true);
  });
}

describe('SQLite shared resource storage', () => {
  let directory: string;
  contract(
    () => {
      directory = mkdtempSync(path.join(tmpdir(), 'icetv-resource-test-'));
      return [
        new LocalSqliteStorage(path.join(directory, 'test.sqlite')),
        new LocalSqliteStorage(path.join(directory, 'test.sqlite')),
      ];
    },
    async (stores) => {
      for (const store of stores)
        (store as unknown as { db: Database.Database }).db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  );
});

const mysqlSuite = process.env.MYSQL_TEST_URL ? describe : describe.skip;
mysqlSuite('MySQL shared resources (real SQL)', () => {
  contract(
    () => [
      new MySqlStorage(process.env.MYSQL_TEST_URL),
      new MySqlStorage(process.env.MYSQL_TEST_URL),
    ],
    async (stores) => {
      for (const store of stores)
        await (
          store as unknown as { pool: { end(): Promise<void> } }
        ).pool.end();
    },
  );
});
