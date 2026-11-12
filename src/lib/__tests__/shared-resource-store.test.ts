/** @jest-environment node */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MySqlStorage } from '@/lib/mysql.db';
import { pruneResourceBatches } from '@/lib/shared-resource-store';
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

  it('shares cooldown deadlines, atomically keeps the longest, and prunes expired entries', async () => {
    const key = `cooldown:host:${randomUUID()}`;
    expect(await stores[0].resources.getCooldown(key)).toBe(0);
    await Promise.all(
      [90_000, 10_000, 60_000, 30_000].map((until, index) =>
        stores[index % stores.length].resources.extendCooldown(key, until),
      ),
    );
    expect(await stores[1].resources.getCooldown(key)).toBe(90_000);
    expect(await stores[0].resources.extendCooldown(key, 20_000)).toBe(90_000);
    await stores[1].resources.prune(89_999);
    expect(await stores[0].resources.getCooldown(key)).toBe(90_000);
    await stores[0].resources.prune(90_000);
    expect(await stores[1].resources.getCooldown(key)).toBe(0);
  });

  it('prunes multiple batches from both tables and preserves unexpired rows', async () => {
    const prefix = randomUUID();
    const now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const storage = stores[0];
      // Seed directly so the test measures pruning, not per-key admission.
      for (const [table, columns, rows] of [
        [
          'shared_resource_usage',
          'resource_key, used, reset_at',
          Array.from({ length: 1201 }, (_, index) => [
            `${prefix}:${index}`,
            1,
            index === 1200 ? now + 1 : now,
          ]),
        ],
        [
          'shared_resource_leases',
          'resource_key, token, expires_at',
          Array.from({ length: 701 }, (_, index) => [
            `${prefix}:${index}`,
            prefix,
            index === 700 ? now + 1 : now,
          ]),
        ],
      ] as const) {
        const sql = `INSERT INTO ${table} (${columns}) VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`;
        if (storage instanceof LocalSqliteStorage) {
          (storage as unknown as { db: Database.Database }).db
            .prepare(sql)
            .run(...rows.flat());
        } else {
          await (
            storage as unknown as { pool: import('mysql2/promise').Pool }
          ).pool.execute(sql, rows.flat());
        }
      }
      await storage.resources.prune(now);
      expect(await storage.resources.getCooldown(`${prefix}:0`)).toBe(0);
      expect(await storage.resources.getCooldown(`${prefix}:1199`)).toBe(0);
      expect(await storage.resources.getCooldown(`${prefix}:1200`)).toBe(
        now + 1,
      );
      expect(
        await storage.resources.renewLeases(
          [`${prefix}:699`],
          prefix,
          now - 1,
          now + 2,
        ),
      ).toBe(false);
      expect(
        await storage.resources.renewLeases(
          [`${prefix}:700`],
          prefix,
          now,
          now + 2,
        ),
      ).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('caps shared connections and fences expired owners across all dimensions', async () => {
    const keys = ['global', 'host', 'user'].map(
      (dimension) => `${randomUUID()}:${dimension}`,
    );
    const resources = keys.map((key) => ({ key, limit: 4 }));
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        stores[index % stores.length].resources.acquireLeases(
          index % 2 ? [...resources].reverse() : resources,
          String(index),
          1000,
          2000,
        ),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(4);
    const owner = String(results.findIndex((result) => result.allowed));
    expect(await stores[1].resources.renewLeases(keys, owner, 1500, 4000)).toBe(
      true,
    );
    await stores[0].resources.prune(2100);
    const one = keys.map((key) => ({ key, limit: 1 }));
    expect(
      (await stores[1].resources.acquireLeases(one, 'next', 2100, 3000))
        .allowed,
    ).toBe(false);
    expect(
      (await stores[1].resources.acquireLeases(one, 'next', 4100, 5000))
        .allowed,
    ).toBe(true);
    await stores[0].resources.releaseLeases(keys, owner);
    expect(await stores[0].resources.renewLeases(keys, owner, 4100, 6000)).toBe(
      false,
    );
    expect(
      (await stores[0].resources.acquireLeases(one, 'blocked', 4200, 5200))
        .allowed,
    ).toBe(false);
    await stores[1].resources.releaseLeases(keys, 'next');
    expect(
      (await stores[0].resources.acquireLeases(one, 'released', 4200, 5200))
        .allowed,
    ).toBe(true);
  });

  it.each([0, 1, 2, 3])(
    'rejects dimension %s without inserting any other lease',
    async (blocked) => {
      const resources = Array.from({ length: 4 }, () => ({
        key: randomUUID(),
        limit: 1,
      }));
      await stores[0].resources.acquireLeases(
        [resources[blocked]],
        'holder',
        1000,
        3000,
      );
      expect(
        await stores[1].resources.acquireLeases(
          resources,
          'refused',
          1100,
          4000,
        ),
      ).toEqual({
        allowed: false,
        rejectedKey: resources[blocked].key,
        retryAfterMs: 1900,
      });
      for (const resource of resources) {
        expect(
          await stores[0].resources.renewLeases(
            [resource.key],
            'refused',
            1200,
            5000,
          ),
        ).toBe(false);
        if (resource !== resources[blocked])
          expect(
            (
              await stores[0].resources.acquireLeases(
                [resource],
                'free',
                1200,
                5000,
              )
            ).allowed,
          ).toBe(true);
      }
    },
  );

  it('uses caller order for refusal and rolls back partial renewal', async () => {
    const resources = ['z', 'a'].map((prefix) => ({
      key: `${prefix}:${randomUUID()}`,
      limit: 1,
    }));
    const keys = resources.map(({ key }) => key);
    await stores[0].resources.acquireLeases(resources, 'holder', 1000, 2000);
    expect(
      await stores[1].resources.acquireLeases(resources, 'refused', 1100, 3000),
    ).toMatchObject({ rejectedKey: keys[0] });
    await stores[0].resources.releaseLeases([keys[1]], 'holder');
    expect(
      await stores[1].resources.renewLeases(keys, 'holder', 1200, 4000),
    ).toBe(false);
    expect(
      await stores[0].resources.renewLeases([keys[0]], 'holder', 2000, 5000),
    ).toBe(false);
    expect(
      (await stores[1].resources.acquireLeases(resources, 'next', 2000, 3000))
        .allowed,
    ).toBe(true);
    await stores[0].resources.releaseLeases(keys, 'holder');
    expect(
      await stores[1].resources.renewLeases(keys, 'next', 2100, 4000),
    ).toBe(true);
    await stores[1].resources.releaseLeases(keys, 'next');
    expect(
      (await stores[0].resources.acquireLeases(resources, 'last', 2200, 4000))
        .allowed,
    ).toBe(true);
  });
}

describe('resource pruning budget', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stops after a partial batch', async () => {
    const prune = jest
      .fn()
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(499);
    await pruneResourceBatches(prune);
    expect(prune).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledWith(500);
  });

  it('stops at the batch cap even when the clock does not advance', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const prune = jest.fn().mockResolvedValue(500);
    await pruneResourceBatches(prune);
    expect(prune).toHaveBeenCalledTimes(20);
  });

  it('does not start another batch after spending the time budget', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const prune = jest.fn().mockImplementation(async () => {
      clock.mockReturnValue(1200);
      return 500;
    });
    await pruneResourceBatches(prune);
    expect(prune).toHaveBeenCalledTimes(1);
  });
});

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
