/** @jest-environment node */

import type Database from 'better-sqlite3';

import { ResourceLimitError } from '@/lib/server-resource-errors';
import { consumeSharedQuota } from '@/lib/shared-resource-quota.server';
import type {
  ResourceAdmission,
  SharedResourceStore,
} from '@/lib/shared-resource-store';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteResourceStore } from '@/lib/sqlite-resource-store';

const KiB = 1024;
const MiB = 1024 * KiB;

describe('pooled shared quota', () => {
  let storage: LocalSqliteStorage;
  let store: SharedResourceStore;
  let key: string;

  beforeEach(() => {
    storage = new LocalSqliteStorage(':memory:');
    store = storage.resources;
    key = `quota:${Math.random()}`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    database().close();
  });

  function database() {
    return (storage as unknown as { db: Database.Database }).db;
  }

  function used(resourceKey = key) {
    const row = database()
      .prepare('SELECT used FROM shared_resource_usage WHERE resource_key = ?')
      .get(resourceKey) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  async function takeUntilRefused(
    target: SharedResourceStore,
    limit: number,
  ): Promise<number> {
    for (let allowed = 0; ; allowed += 1) {
      try {
        await consumeSharedQuota(target, key, 1, limit, 429);
      } catch {
        return allowed;
      }
    }
  }

  it('sizes blocks from the limit within unit bounds', async () => {
    const cases: Array<[number, 'requests' | 'bytes', number]> = [
      [30, 'requests', 1],
      [1200, 'requests', 18],
      [12_000, 'requests', 64],
      [MiB, 'bytes', 256 * KiB],
      [192 * MiB, 'bytes', 3 * MiB],
      [1536 * MiB, 'bytes', 8 * MiB],
    ];
    for (const [limit, unit, block] of cases) {
      const target = `${unit}:${limit}`;
      await consumeSharedQuota(store, target, 1, limit, 503, unit);
      expect(used(target)).toBe(block);
    }
  });

  it('reuses one store per storage so pools persist across calls', () => {
    expect(storage.resources).toBe(storage.resources);
  });

  it('allows exactly the limit and stops calling the database once refused', async () => {
    const consume = jest.spyOn(store, 'consume');
    expect(await takeUntilRefused(store, 1000)).toBe(1000);
    expect(used()).toBe(1000);
    expect(consume.mock.calls.length).toBeLessThan(100);
    const calls = consume.mock.calls.length;
    const refusal = await consumeSharedQuota(store, key, 1, 1000, 429).catch(
      (error) => error,
    );
    expect(refusal).toMatchObject({ status: 429 });
    expect(refusal.retryAfterSeconds).toBeGreaterThan(0);
    expect(consume).toHaveBeenCalledTimes(calls);
  });

  it('rounds byte reservations to 256 KiB and stays exact near the limit', async () => {
    const take = (bytes: number) =>
      consumeSharedQuota(store, key, bytes, MiB, 429, 'bytes');
    await take(600 * KiB);
    expect(used()).toBe(768 * KiB);
    await take(424 * KiB);
    expect(used()).toBe(MiB);
    await expect(take(1)).rejects.toMatchObject({ status: 429 });
  });

  it('never over-issues across instances; idle blocks only cause early refusal', async () => {
    const other = new SqliteResourceStore(database());
    await consumeSharedQuota(store, key, 1, 640, 429);
    await consumeSharedQuota(other, key, 1, 640, 429);
    const first = 1 + (await takeUntilRefused(store, 640));
    // 另一实例仍持有 9 个未用额度，本实例因此比上限早 10 个被拒
    expect(first).toBe(630);
    const second = 1 + (await takeUntilRefused(other, 640));
    expect(first + second).toBe(640);
    expect(used()).toBe(640);
  });

  it('discards local balance and refusals when the database window resets', async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    const consume = jest.spyOn(store, 'consume');
    await consumeSharedQuota(store, key, 1, 640);
    clock.mockReturnValue(start + 59_999);
    await consumeSharedQuota(store, key, 1, 640);
    expect(consume).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(start + 60_000);
    await consumeSharedQuota(store, key, 1, 640);
    expect(consume).toHaveBeenCalledTimes(2);
    // 新窗口只计入新预约的一块，旧窗口剩余的 8 个不带入
    expect(used()).toBe(10);

    const single = `${key}:single`;
    await consumeSharedQuota(store, single, 1, 1);
    await expect(consumeSharedQuota(store, single, 1, 1)).rejects.toMatchObject(
      { status: 503 },
    );
    clock.mockReturnValue(start + 120_000);
    await expect(consumeSharedQuota(store, single, 1, 1)).resolves.toBe(
      undefined,
    );
  });

  it('merges concurrent refills into one in-flight database call', async () => {
    const original = store.consume.bind(store);
    let inFlight = 0;
    let peak = 0;
    const consume = jest
      .spyOn(store, 'consume')
      .mockImplementation(async (...args) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return original(...args);
      });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeSharedQuota(store, key, 1, 64 * 64),
      ),
    );
    expect(consume).toHaveBeenCalledTimes(1);
    consume.mockClear();
    const other = `${key}:small-block`;
    await Promise.all(
      Array.from({ length: 25 }, () =>
        consumeSharedQuota(store, other, 1, 640),
      ),
    );
    expect(consume).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
    expect(used(other)).toBe(30);
  });

  it('isolates pools per store instance', async () => {
    const otherStorage = new LocalSqliteStorage(':memory:');
    try {
      const otherStore = otherStorage.resources;
      const consume = jest.spyOn(otherStore, 'consume');
      await consumeSharedQuota(store, key, 1, 640);
      await consumeSharedQuota(otherStore, key, 1, 640);
      expect(consume).toHaveBeenCalledTimes(1);
      expect(used()).toBe(10);
    } finally {
      (otherStorage as unknown as { db: Database.Database }).db.close();
    }
  });

  it('fails closed on database errors unless local balance covers the request', async () => {
    await consumeSharedQuota(store, key, 1, 640, 429);
    const consume = jest
      .spyOn(store, 'consume')
      .mockRejectedValue(new Error('database down'));
    for (let index = 0; index < 9; index += 1)
      await consumeSharedQuota(store, key, 1, 640, 429);
    expect(consume).not.toHaveBeenCalled();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        consumeSharedQuota(store, key, 1, 640, 429),
      ),
    );
    expect(consume).toHaveBeenCalledTimes(1);
    for (const result of results)
      expect(result).toMatchObject({
        status: 'rejected',
        reason: { status: 503 },
      });
  });

  it('fails waiters of a hung refill like a database error and refills again afterwards', async () => {
    jest.useFakeTimers('modern');
    const consume = jest
      .spyOn(store, 'consume')
      .mockReturnValueOnce(new Promise<ResourceAdmission>(() => {}));
    let settled = 0;
    const waiters = Array.from({ length: 3 }, () =>
      consumeSharedQuota(store, key, 1, 640, 429).catch((error) => {
        settled += 1;
        return error;
      }),
    );
    jest.advanceTimersByTime(2_999);
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(settled).toBe(0);
    jest.advanceTimersByTime(1);
    for (const error of await Promise.all(waiters)) {
      expect(error).toBeInstanceOf(ResourceLimitError);
      expect(error).toMatchObject({ status: 503, retryAfterSeconds: 1 });
    }
    expect(consume).toHaveBeenCalledTimes(1);
    await consumeSharedQuota(store, key, 1, 640, 429);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(used()).toBe(10);
    // 按时返回的预约不留下超时计时器
    expect(jest.getTimerCount()).toBe(0);
  });

  it('drops late refill results without crediting them or leaving rejections unhandled', async () => {
    jest.useFakeTimers('modern');
    let allowLate!: (admission: ResourceAdmission) => void;
    let failLate!: (error: Error) => void;
    const consume = jest
      .spyOn(store, 'consume')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          allowLate = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          failLate = reject;
        }),
      );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refused = consumeSharedQuota(store, key, 1, 640, 429);
      jest.advanceTimersByTime(3_000);
      await expect(refused).rejects.toMatchObject({ status: 503 });
    }
    allowLate({ allowed: true, retryAfterMs: 60_000 });
    failLate(new Error('connection reset'));
    jest.useRealTimers();
    // 经过真实宏任务后 Node 才判定未处理的 rejection，有则本用例失败
    await new Promise((resolve) => setImmediate(resolve));
    // 迟到放行的一整块若入账，这次会直接用本地余额而不再查库
    await consumeSharedQuota(store, key, 1, 640, 429);
    expect(consume).toHaveBeenCalledTimes(3);
    expect(used()).toBe(10);
  });
});
