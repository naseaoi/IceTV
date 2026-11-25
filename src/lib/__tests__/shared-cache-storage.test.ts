/** @jest-environment node */

import type Database from 'better-sqlite3';
import type { Pool, RowDataPacket } from 'mysql2/promise';
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

  async function sql(query: string, params: (string | number | null)[] = []) {
    if (storage instanceof LocalSqliteStorage) {
      const database = (storage as unknown as { db: Database.Database }).db;
      const stmt = database.prepare(query);
      return stmt.reader ? stmt.all(...params) : stmt.run(...params);
    }
    const [result] = await (storage as unknown as { pool: Pool }).pool.query(
      query,
      params,
    );
    return result;
  }

  it('stores UTF-8 bytes and preserves them when an old token writes', async () => {
    const key = randomUUID();
    await storage.acquireSharedCacheLease(key, 'writer', 1000, 2000);
    await storage.setSharedCache(key, 'writer', '中文', 3000, 4000, 1100);
    await storage.setSharedCache(key, 'old', 'x', 3000, 4000, 1200);
    expect(
      await sql('SELECT value_bytes FROM shared_cache WHERE cache_key = ?', [
        key,
      ]),
    ).toEqual([expect.objectContaining({ value_bytes: 6 })]);
  });

  it('reads capacity metadata through a covering index without sorting bodies', async () => {
    const mysql = storage instanceof MySqlStorage;
    const rows = (await sql(
      `${mysql ? 'EXPLAIN' : 'EXPLAIN QUERY PLAN'}
      SELECT cache_key, updated_at, value_bytes FROM shared_cache
      ${mysql ? 'FORCE INDEX (idx_shared_cache_budget)' : 'INDEXED BY idx_shared_cache_budget'}
      WHERE lease_until <= ? ORDER BY updated_at DESC, cache_key DESC LIMIT 4097`,
      [2000],
    )) as RowDataPacket[];
    if (mysql) {
      expect(rows[0].key).toBe('idx_shared_cache_budget');
      expect(rows[0].Extra).toContain('Using index');
      expect(rows[0].Extra).not.toContain('filesort');
    } else {
      expect(
        rows.some((row) =>
          String(row.detail).includes('COVERING INDEX idx_shared_cache_budget'),
        ),
      ).toBe(true);
      expect(
        rows.some((row) => String(row.detail).includes('TEMP B-TREE')),
      ).toBe(false);
    }
  });

  it('drains expiry across batches and protects active leases', async () => {
    await sql('DELETE FROM shared_cache');
    for (let batch = 0; batch < 3; batch += 1) {
      const params: (string | number)[] = [];
      for (let i = 0; i < 250; i += 1)
        params.push(`expired-${batch}-${i}`, 'body', 4, 1, 1, 0, 1);
      await sql(
        `INSERT INTO shared_cache (cache_key, value_text, value_bytes, fresh_until, stale_until, lease_until, updated_at)
        VALUES ${Array(250).fill('(?, ?, ?, ?, ?, ?, ?)').join(',')}`,
        params,
      );
    }
    await storage.acquireSharedCacheLease('active', 'owner', 1, 5000);
    await storage.pruneSharedCache(2000, 250);
    const rows = await sql('SELECT cache_key FROM shared_cache');
    expect(rows).toEqual([expect.objectContaining({ cache_key: 'active' })]);
  });

  it('trims using exact byte metadata after legacy backfill and preserves active leases', async () => {
    await sql('DELETE FROM shared_cache');
    for (let i = 0; i < 66; i += 1) {
      await sql(
        `INSERT INTO shared_cache (cache_key, value_text, value_bytes, fresh_until, stale_until, lease_until, updated_at)
        VALUES (?, 'tiny', ?, 9000, 10000, 0, ?)`,
        [String(i).padStart(3, '0'), i === 65 ? null : 2 * 1024 * 1024, i],
      );
    }
    await storage.acquireSharedCacheLease('active', 'owner', 1, 5000);
    await storage.pruneSharedCache(2000, 250);
    expect(await storage.getSharedCache('000')).toBeNull();
    expect(await storage.getSharedCache('001')).toBeNull();
    expect(await storage.getSharedCache('002')).not.toBeNull();
    expect(await storage.getSharedCache('065')).not.toBeNull();
    expect(await storage.getSharedCache('active')).not.toBeNull();
    const rows = (await sql(
      'SELECT COUNT(*) AS total FROM shared_cache',
    )) as RowDataPacket[];
    expect(Number(rows[0].total)).toBe(65);
  });

  it('backfills a thousand legacy values without evicting warm cache entries', async () => {
    await sql('DELETE FROM shared_cache');
    const value = '汉字\u0000 café 𠮷';
    for (let start = 0; start < 1000; start += 250) {
      const params: string[] = [];
      for (let i = start; i < start + 250; i += 1)
        params.push(String(i).padStart(4, '0'), value);
      await sql(
        `INSERT INTO shared_cache (cache_key, value_text, value_bytes, fresh_until, stale_until, lease_until, updated_at)
        VALUES ${Array(250).fill('(?, ?, NULL, 9000, 10000, 0, 1)').join(',')}`,
        params,
      );
    }
    let rows: RowDataPacket[] = [];
    for (let round = 0; round < 10; round += 1) {
      await storage.pruneSharedCache(2000, 250);
      rows = (await sql(
        'SELECT value_text, value_bytes, fresh_until, stale_until, updated_at FROM shared_cache',
      )) as RowDataPacket[];
      expect(rows).toHaveLength(1000);
      if (rows.every((row) => row.value_bytes !== null)) break;
    }
    for (const row of rows) {
      expect(row).toMatchObject({
        value_text: value,
        value_bytes: Buffer.byteLength(value),
        fresh_until: 9000,
        stale_until: 10000,
        updated_at: 1,
      });
    }
  });

  it('keeps the newest 4096 entries with deterministic tie breaking', async () => {
    await sql('DELETE FROM shared_cache');
    for (let start = 0; start < 4100; start += 100) {
      const params: (string | number)[] = [];
      for (let i = start; i < start + 100; i += 1)
        params.push(String(i).padStart(5, '0'));
      await sql(
        `INSERT INTO shared_cache (cache_key, value_text, value_bytes, fresh_until, stale_until, lease_until, updated_at)
        VALUES ${Array(100).fill("(?, 'x', 1, 9000, 10000, 0, 1)").join(',')}`,
        params,
      );
    }
    await storage.pruneSharedCache(2000, 250);
    const rows = (await sql(
      'SELECT COUNT(*) AS total FROM shared_cache',
    )) as RowDataPacket[];
    expect(Number(rows[0].total)).toBe(4096);
    expect(await storage.getSharedCache('00003')).toBeNull();
    expect(await storage.getSharedCache('00004')).not.toBeNull();
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

  it('adds byte metadata to the legacy schema without reading or losing old values', async () => {
    await sql('DROP TABLE shared_cache');
    const mysql = storage instanceof MySqlStorage;
    await sql(`CREATE TABLE shared_cache (
      cache_key ${mysql ? 'VARCHAR(191)' : 'TEXT'} PRIMARY KEY,
      value_text TEXT NOT NULL,
      fresh_until BIGINT NOT NULL,
      stale_until BIGINT NOT NULL,
      lease_token ${mysql ? 'VARCHAR(64)' : 'TEXT'},
      lease_until BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    )`);
    await sql(
      "INSERT INTO shared_cache (cache_key, value_text, fresh_until, stale_until, updated_at) VALUES ('legacy', '旧值', 9000, 10000, 1)",
    );
    await (
      storage as unknown as { initializeSchema(): void | Promise<void> }
    ).initializeSchema();
    expect(
      await sql(
        "SELECT value_bytes FROM shared_cache WHERE cache_key = 'legacy'",
      ),
    ).toEqual([expect.objectContaining({ value_bytes: null })]);
    expect((await storage.getSharedCache('legacy'))?.value).toBe('旧值');
    await storage.acquireSharedCacheLease('legacy', 'refresh', 1000, 2000);
    await storage.setSharedCache(
      'legacy',
      'refresh',
      '更新',
      9000,
      10000,
      1100,
    );
    expect(
      await sql(
        "SELECT value_bytes FROM shared_cache WHERE cache_key = 'legacy'",
      ),
    ).toEqual([expect.objectContaining({ value_bytes: 6 })]);
  });

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
  it('reuses prepared metadata and trim statements across maintenance runs', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const database = (storage as unknown as { db: Database.Database }).db;
    const prepare = jest.spyOn(database, 'prepare');
    try {
      await storage.pruneSharedCache(2000, 250);
      await storage.pruneSharedCache(2000, 250);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
      database.close();
    }
  });
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
