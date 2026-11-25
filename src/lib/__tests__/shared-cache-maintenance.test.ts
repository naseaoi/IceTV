/** @jest-environment node */

import {
  pruneSharedCacheBatches,
  SHARED_CACHE_PRUNE_MAX_BATCHES,
  SHARED_CACHE_PRUNE_MAX_MS,
  sharedCacheOverflowBoundary,
} from '@/lib/shared-cache-maintenance';

it('drains multiple expiry batches and yields between them', async () => {
  const expire = jest
    .fn()
    .mockResolvedValueOnce(250)
    .mockResolvedValueOnce(250)
    .mockResolvedValue(0);
  const turn = jest.fn();
  setTimeout(turn, 0);
  await pruneSharedCacheBatches(
    1000,
    expire,
    async () => [],
    jest.fn(),
    jest.fn(),
  );
  expect(expire.mock.calls).toEqual([[250], [250], [250]]);
  expect(turn).toHaveBeenCalledTimes(1);
});

it('bounds expiry deletion even when the backlog never ends', async () => {
  jest.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const expire = jest.fn().mockResolvedValue(250);
    const metadata = jest.fn();
    await pruneSharedCacheBatches(250, expire, metadata, jest.fn(), jest.fn());
    expect(expire).toHaveBeenCalledTimes(SHARED_CACHE_PRUNE_MAX_BATCHES);
    expect(metadata).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
  }
});

it('stops after a batch exhausts the time budget', async () => {
  let elapsed = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => elapsed);
  try {
    const expire = jest.fn(async () => {
      elapsed = SHARED_CACHE_PRUNE_MAX_MS;
      return 250;
    });
    const metadata = jest.fn();
    await pruneSharedCacheBatches(250, expire, metadata, jest.fn(), jest.fn());
    expect(expire).toHaveBeenCalledTimes(1);
    expect(metadata).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
  }
});

it('bounds capacity deletion with the same batch budget', async () => {
  jest.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const boundary = {
      cache_key: 'large',
      updated_at: 1,
      value_bytes: 129 * 1024 * 1024,
    };
    const trim = jest.fn().mockResolvedValue(250);
    await pruneSharedCacheBatches(
      250,
      async () => 0,
      async () => [boundary],
      trim,
      jest.fn(),
    );
    expect(trim).toHaveBeenCalledTimes(SHARED_CACHE_PRUNE_MAX_BATCHES - 1);
    expect(trim).toHaveBeenLastCalledWith(boundary, 250);
  } finally {
    jest.restoreAllMocks();
  }
});

it('defers byte trimming while any metadata is unknown, but still enforces count', () => {
  const rows = Array.from({ length: 4097 }, (_, index) => ({
    cache_key: String(index),
    updated_at: 1,
    value_bytes: index === 0 ? 129 * 1024 * 1024 : null,
  }));
  expect(sharedCacheOverflowBoundary(rows.slice(0, 1000))).toBeUndefined();
  expect(sharedCacheOverflowBoundary(rows)).toBe(rows[4096]);
});

it('backfills at most 250 keys per batch and restores byte trimming after rereading', async () => {
  const rows = Array.from({ length: 750 }, (_, index) => ({
    cache_key: String(index),
    updated_at: 1,
    value_bytes: null as number | null,
  }));
  const metadata = jest.fn(async () => rows);
  const trim = jest.fn(async () => 0);
  const backfill = jest.fn(async (keys: string[]) => {
    expect(trim).not.toHaveBeenCalled();
    for (const key of keys) rows[Number(key)].value_bytes = 2 * 1024 * 1024;
  });
  await pruneSharedCacheBatches(1000, async () => 0, metadata, trim, backfill);
  expect(backfill.mock.calls.map(([keys]) => keys.length)).toEqual([
    250, 250, 250,
  ]);
  expect(metadata).toHaveBeenCalledTimes(2);
  expect(trim).toHaveBeenCalledWith(rows[64], 250);
});

it('charges backfill to the same batch budget and leaves remaining rows for later', async () => {
  jest.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      cache_key: String(index),
      updated_at: 1,
      value_bytes: null,
    }));
    const backfill = jest.fn(async () => {});
    const trim = jest.fn();
    await pruneSharedCacheBatches(
      1,
      async () => 0,
      async () => rows,
      trim,
      backfill,
    );
    expect(backfill).toHaveBeenCalledTimes(SHARED_CACHE_PRUNE_MAX_BATCHES - 1);
    expect(trim).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
  }
});

it('trims excess entry count even when backfill exhausts the time budget', async () => {
  let elapsed = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => elapsed);
  try {
    const rows = Array.from({ length: 4097 }, (_, index) => ({
      cache_key: String(index),
      updated_at: 1,
      value_bytes: null,
    }));
    const trim = jest.fn(async () => 1);
    const backfill = jest.fn(async () => {
      elapsed = SHARED_CACHE_PRUNE_MAX_MS;
    });
    await pruneSharedCacheBatches(
      250,
      async () => 0,
      async () => rows,
      trim,
      backfill,
    );
    expect(trim).toHaveBeenCalledTimes(1);
    expect(trim).toHaveBeenCalledWith(rows[4096], 250);
    expect(backfill).toHaveBeenCalledTimes(1);
  } finally {
    jest.restoreAllMocks();
  }
});
