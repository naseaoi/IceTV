/** @jest-environment node */

import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

import { db } from '@/lib/db';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

describe('shared server cache', () => {
  let storage: LocalSqliteStorage;
  const methods = [
    'getSharedCache',
    'acquireSharedCacheLease',
    'setSharedCache',
    'releaseSharedCacheLease',
    'renewSharedCacheLease',
    'pruneSharedCache',
  ] as const;

  beforeEach(() => {
    storage = new LocalSqliteStorage(':memory:');
    for (const method of methods) {
      jest
        .spyOn(db, method)
        .mockImplementation(storage[method].bind(storage) as never);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (storage as unknown as { db: Database.Database }).db.close();
  });

  function cache(name = 'shared-test', maxWaitMs = 2000) {
    return createSharedServerCache<string>({
      name,
      freshMs: 1000,
      staleMs: 1000,
      enabled: true,
      maxWaitMs,
    });
  }

  it('reuses a result across independent cache instances', async () => {
    const loader = jest.fn(async () => 'value');
    await expect(cache().getOrLoad('same', loader)).resolves.toBe('value');
    await expect(cache().getOrLoad('same', loader)).resolves.toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces fifty simultaneous instances on a cold key', async () => {
    const loader = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 'value';
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => cache().getOrLoad('same', loader)),
    );
    expect(results.every((result) => result === 'value')).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not rerun a rejected origin loader', async () => {
    const loader = jest.fn(async () => {
      throw new Error('origin failed');
    });
    await expect(cache().getOrLoad('same', loader)).rejects.toThrow(
      'origin failed',
    );
    expect(loader).toHaveBeenCalledTimes(1);
    const key = `shared-test:${createHash('sha256').update('same').digest('hex')}`;
    expect(await storage.getSharedCache(key)).toBeNull();
    await expect(
      cache().getOrLoad('same', async () => 'recovered'),
    ).resolves.toBe('recovered');
  });

  it('does not bypass a held lease after the wait deadline', async () => {
    const key = `shared-test:${createHash('sha256').update('same').digest('hex')}`;
    await storage.acquireSharedCacheLease(
      key,
      'holder',
      Date.now(),
      Date.now() + 30_000,
    );
    const loader = jest.fn(async () => 'unexpected');
    await expect(
      cache('shared-test', 100).getOrLoad('same', loader),
    ).rejects.toBeInstanceOf(ResourceLimitError);
    expect(loader).not.toHaveBeenCalled();
  });

  it('fails closed when the shared store is unavailable', async () => {
    jest
      .spyOn(db, 'getSharedCache')
      .mockRejectedValue(new Error('database down'));
    const loader = jest.fn(async () => 'unexpected');
    await expect(cache().getOrLoad('same', loader)).rejects.toBeInstanceOf(
      ResourceLimitError,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('preserves absolute expiry when hydrating another instance', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    await cache().getOrLoad('same', async () => 'old');
    clock.mockReturnValue(1900);
    const second = cache();
    await second.getOrLoad('same', async () => 'unused');
    clock.mockReturnValue(2100);
    expect(second.peek('same')).toEqual({ value: 'old', fresh: false });
    clock.mockReturnValue(3100);
    expect(second.peek('same')).toBeNull();
  });

  it('writes shared expiry from getTtl so other instances hydrate the same window', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const options = {
      name: 'ttl-test',
      freshMs: 1000,
      staleMs: 1000,
      enabled: true,
      getTtl: () => ({ freshMs: 60_000, staleMs: 5000 }),
    };
    await createSharedServerCache<string>(options).getOrLoad(
      'same',
      async () => 'long',
    );
    expect(db.setSharedCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      '"long"',
      61_000,
      66_000,
      1000,
    );

    clock.mockReturnValue(30_000);
    const second = createSharedServerCache<string>(options);
    const loader = jest.fn(async () => 'unused');
    await expect(second.getOrLoad('same', loader)).resolves.toBe('long');
    expect(loader).not.toHaveBeenCalled();
    clock.mockReturnValue(62_000);
    expect(second.peek('same')).toEqual({ value: 'long', fresh: false });
    clock.mockReturnValue(66_000);
    expect(second.peek('same')).toBeNull();
  });

  it('falls back like the local cache when getTtl omits the stale window', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    await createSharedServerCache<string>({
      name: 'ttl-cache-stale',
      freshMs: 1000,
      staleMs: 3000,
      enabled: true,
      getTtl: () => ({ freshMs: 60_000 }),
    }).getOrLoad('same', async () => 'cache-stale');
    await createSharedServerCache<string>({
      name: 'ttl-cache-fresh',
      freshMs: 1000,
      enabled: true,
      getTtl: () => ({ freshMs: 60_000 }),
    }).getOrLoad('same', async () => 'cache-fresh');

    expect(db.setSharedCache).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.any(String),
      '"cache-stale"',
      61_000,
      64_000,
      1000,
    );
    expect(db.setSharedCache).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.any(String),
      '"cache-fresh"',
      61_000,
      62_000,
      1000,
    );
  });

  it('keeps the cache-level expiry when getTtl is absent', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    await createSharedServerCache<string>({
      name: 'no-ttl-stale',
      freshMs: 1000,
      staleMs: 500,
      enabled: true,
    }).getOrLoad('same', async () => 'with-stale');
    await createSharedServerCache<string>({
      name: 'no-ttl-fresh',
      freshMs: 1000,
      enabled: true,
    }).getOrLoad('same', async () => 'fresh-only');

    expect(db.setSharedCache).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.any(String),
      '"with-stale"',
      2000,
      2500,
      1000,
    );
    expect(db.setSharedCache).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.any(String),
      '"fresh-only"',
      2000,
      3000,
      1000,
    );
  });

  it('round-trips binary cover data with an explicit codec', async () => {
    const options = {
      name: 'binary-test',
      freshMs: 1000,
      staleMs: 0,
      enabled: true,
      estimateWeight: (value: ArrayBuffer) => value.byteLength,
      serialize: (value: ArrayBuffer) => Buffer.from(value).toString('base64'),
      deserialize: (value: string) =>
        Uint8Array.from(Buffer.from(value, 'base64')).buffer,
    };
    const data = new Uint8Array([0, 128, 255]).buffer;
    await createSharedServerCache<ArrayBuffer>(options).getOrLoad(
      'cover',
      async () => data,
    );
    const loaded = await createSharedServerCache<ArrayBuffer>(
      options,
    ).getOrLoad('cover', async () => new ArrayBuffer(0));
    expect(new Uint8Array(loaded)).toEqual(new Uint8Array(data));
  });

  it('does not cache rejected values or oversized shared entries', async () => {
    const small = createSharedServerCache<string>({
      name: 'bounded',
      freshMs: 1000,
      staleMs: 0,
      enabled: true,
      maxWeightBytes: 10,
    });
    await small.getOrLoad('large', async () => 'x'.repeat(100));
    expect(small.stats().size).toBe(0);
    expect(db.setSharedCache).not.toHaveBeenCalled();
    const key = `bounded:${createHash('sha256').update('large').digest('hex')}`;
    expect(await storage.getSharedCache(key)).toBeNull();
  });

  it('removes placeholders when shouldCache rejects the loaded value', async () => {
    const rejected = createSharedServerCache<string>({
      name: 'rejected',
      freshMs: 1000,
      enabled: true,
      shouldCache: () => false,
    });
    await expect(rejected.getOrLoad('same', async () => 'value')).resolves.toBe(
      'value',
    );
    const key = `rejected:${createHash('sha256').update('same').digest('hex')}`;
    expect(await storage.getSharedCache(key)).toBeNull();
    expect(db.setSharedCache).not.toHaveBeenCalled();
  });
});
