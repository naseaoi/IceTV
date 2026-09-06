import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { type SwrCacheOptions, createSwrCache } from '@/lib/server-cache';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import type { SharedCacheRecord } from '@/lib/types';

export interface SharedServerCacheOptions<T> extends SwrCacheOptions<T> {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
  leaseMs?: number;
  maxWaitMs?: number;
  shouldCache?: (value: T) => boolean;
  enabled?: boolean;
}

const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
let lastPruneAt = 0;

export function createSharedServerCache<T>(
  options: SharedServerCacheOptions<T>,
) {
  const local = createSwrCache<T>(options);
  const inflight = new Map<string, Promise<T>>();
  const serialize = options.serialize || JSON.stringify;
  const deserialize =
    options.deserialize || ((value: string) => JSON.parse(value) as T);
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'test';
  const leaseMs = Math.max(1000, options.leaseMs ?? 30_000);
  const maxWaitMs = Math.max(100, options.maxWaitMs ?? 45_000);
  let generation = 0;
  const counters = {
    sharedHits: 0,
    sharedMisses: 0,
    leaseWaits: 0,
    unavailable: 0,
  };

  function readRecord(
    key: string,
    record: SharedCacheRecord | null,
  ): { value: T; fresh: boolean } | null {
    if (!record?.value || record.staleUntil <= Date.now()) return null;
    try {
      const value = deserialize(record.value);
      if (options.shouldCache && !options.shouldCache(value)) return null;
      local.hydrate(key, value, record.freshUntil, record.staleUntil);
      return { value, fresh: record.freshUntil > Date.now() };
    } catch {
      return null;
    }
  }

  async function loadOrigin(
    key: string,
    sharedKey: string,
    token: string,
    loader: () => Promise<T>,
    expectedGeneration: number,
  ): Promise<T> {
    let ownsLease = true;
    let renewing = false;
    const heartbeat = setInterval(
      async () => {
        if (renewing || !ownsLease) return;
        renewing = true;
        try {
          const now = Date.now();
          ownsLease = await db.renewSharedCacheLease(
            sharedKey,
            token,
            now,
            now + leaseMs,
          );
        } catch {
          ownsLease = false;
        } finally {
          renewing = false;
        }
      },
      Math.floor(leaseMs / 3),
    );
    heartbeat.unref?.();
    try {
      const value = await loader();
      if (options.shouldCache && !options.shouldCache(value)) return value;
      if (generation === expectedGeneration) local.set(key, value);
      const serialized = serialize(value);
      if (
        !ownsLease ||
        typeof serialized !== 'string' ||
        Buffer.byteLength(serialized) >
          Math.min(MAX_ENTRY_BYTES, options.maxWeightBytes ?? MAX_ENTRY_BYTES)
      )
        return value;
      const now = Date.now();
      await db.setSharedCache(
        sharedKey,
        token,
        serialized,
        now + options.freshMs,
        now + options.freshMs + (options.staleMs ?? options.freshMs),
        now,
      );
      if (now - lastPruneAt >= 60_000) {
        lastPruneAt = now;
        await db.pruneSharedCache(now, 100);
      }
      return value;
    } finally {
      clearInterval(heartbeat);
      await db.releaseSharedCacheLease(sharedKey, token).catch(() => {});
    }
  }

  async function load(
    key: string,
    loader: () => Promise<T>,
    expectedGeneration: number,
  ): Promise<T> {
    if (!enabled) {
      const value = await loader();
      if (
        generation === expectedGeneration &&
        (!options.shouldCache || options.shouldCache(value))
      )
        local.set(key, value);
      return value;
    }
    const sharedKey = `${options.name}:${createHash('sha256').update(key).digest('hex')}`;
    const deadline = Date.now() + maxWaitMs;
    let delayMs = 50;
    while (true) {
      let lease: string | null = null;
      try {
        const cached = readRecord(key, await db.getSharedCache(sharedKey));
        if (cached?.fresh) {
          counters.sharedHits += 1;
          return cached.value;
        }
        const now = Date.now();
        const token = randomUUID();
        if (
          await db.acquireSharedCacheLease(sharedKey, token, now, now + leaseMs)
        ) {
          lease = token;
          const rechecked = readRecord(key, await db.getSharedCache(sharedKey));
          if (rechecked?.fresh) {
            await db.releaseSharedCacheLease(sharedKey, token);
            counters.sharedHits += 1;
            return rechecked.value;
          }
        } else if (cached) {
          counters.sharedHits += 1;
          return cached.value;
        }
      } catch {
        if (lease)
          await db.releaseSharedCacheLease(sharedKey, lease).catch(() => {});
        counters.unavailable += 1;
        const stale = local.peek(key);
        if (stale) return stale.value;
        throw new ResourceLimitError();
      }
      if (lease) {
        counters.sharedMisses += 1;
        return loadOrigin(key, sharedKey, lease, loader, expectedGeneration);
      }
      if (Date.now() >= deadline) throw new ResourceLimitError();
      counters.leaseWaits += 1;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(delayMs, deadline - Date.now())),
      );
      delayMs = Math.min(1000, delayMs * 2);
    }
  }

  function startLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const task = load(key, loader, generation).finally(() => {
      if (inflight.get(key) === task) inflight.delete(key);
    });
    inflight.set(key, task);
    return task;
  }

  return {
    async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
      const cached = local.peek(key);
      if (cached) {
        if (!cached.fresh) void startLoad(key, loader).catch(() => {});
        return cached.value;
      }
      return startLoad(key, loader);
    },
    async refresh(key: string, loader: () => Promise<T>): Promise<void> {
      await startLoad(key, loader);
    },
    set: local.set,
    peek: local.peek,
    invalidate: local.invalidate,
    clear() {
      generation += 1;
      local.clear();
      inflight.clear();
    },
    stats() {
      return { ...local.stats(), ...counters, inflight: inflight.size };
    },
  };
}
