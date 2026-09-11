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
  });
});
