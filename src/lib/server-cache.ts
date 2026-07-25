/**
 * 服务端内存缓存（SWR 软过期 + 请求去重 + LRU）。
 */

interface Entry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
  weight: number;
  lastAccess: number;
}

export interface SwrCacheOptions<T = unknown> {
  name: string;
  maxSize?: number;
  maxWeightBytes?: number;
  estimateWeight?: (value: T) => number;
  freshMs: number;
  staleMs?: number;
}

export interface SwrCacheStats {
  size: number;
  estimatedBytes: number;
  hits: number;
  misses: number;
  freshHits: number;
  staleHits: number;
  evictions: number;
  expirations: number;
  oversizedSkips: number;
  inflight: number;
}

const DEFAULT_MAX_SIZE = 1000;

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function estimateUtf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length * 2;
}

function estimateDefaultWeight(value: unknown): number {
  if (typeof value === 'string') return estimateUtf8Bytes(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (value === null || value === undefined) return 0;

  try {
    return estimateUtf8Bytes(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function normalizeWeight(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function createSwrCache<T>(opts: SwrCacheOptions<T>) {
  const {
    name,
    freshMs,
    staleMs = freshMs,
    maxWeightBytes,
    estimateWeight,
  } = opts;
  const maxSize = normalizeLimit(opts.maxSize, DEFAULT_MAX_SIZE);
  const maxWeight =
    maxWeightBytes === undefined
      ? Number.POSITIVE_INFINITY
      : normalizeLimit(maxWeightBytes, 0);
  const store = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();
  let estimatedBytes = 0;
  let accessSequence = 0;
  let cacheGeneration = 0;
  const counters = {
    hits: 0,
    misses: 0,
    freshHits: 0,
    staleHits: 0,
    evictions: 0,
    expirations: 0,
    oversizedSkips: 0,
  };

  function touch(entry: Entry<T>): void {
    entry.lastAccess = ++accessSequence;
  }

  function remove(key: string, reason?: 'eviction' | 'expiration'): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    store.delete(key);
    estimatedBytes = Math.max(0, estimatedBytes - entry.weight);
    if (reason === 'eviction') counters.evictions += 1;
    if (reason === 'expiration') counters.expirations += 1;
    return true;
  }

  function cleanupExpired(now: number): void {
    for (const [key, entry] of store) {
      if (now >= entry.staleUntil) {
        remove(key, 'expiration');
      }
    }
  }

  function resolveWeight(value: T): number {
    if (!estimateWeight) return estimateDefaultWeight(value);
    try {
      return normalizeWeight(estimateWeight(value));
    } catch {
      return estimateDefaultWeight(value);
    }
  }

  function evictIfNeeded(): void {
    while (store.size > maxSize || estimatedBytes > maxWeight) {
      let oldestKey: string | null = null;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [key, entry] of store) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      remove(oldestKey, 'eviction');
    }
  }

  function write(key: string, value: T, now: number): boolean {
    cleanupExpired(now);
    const weight = resolveWeight(value);

    if (maxSize <= 0 || weight > maxWeight) {
      counters.oversizedSkips += 1;
      if (maxSize <= 0) {
        remove(key);
      }
      return false;
    }

    remove(key);
    const entry: Entry<T> = {
      value,
      freshUntil: now + freshMs,
      staleUntil: now + freshMs + staleMs,
      weight,
      lastAccess: ++accessSequence,
    };
    store.set(key, entry);
    estimatedBytes += weight;
    evictIfNeeded();
    return store.get(key) === entry;
  }

  function load(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing;

    const generation = cacheGeneration;
    const promise = loader()
      .then((value) => {
        if (generation === cacheGeneration) {
          write(key, value, Date.now());
        }
        return value;
      })
      .finally(() => {
        if (inflight.get(key) === promise) {
          inflight.delete(key);
        }
      });
    inflight.set(key, promise);
    return promise;
  }

  function readStats(): SwrCacheStats {
    cleanupExpired(Date.now());
    return {
      size: store.size,
      estimatedBytes,
      ...counters,
      inflight: inflight.size,
    };
  }

  return {
    name,
    async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit) {
        if (now < hit.freshUntil) {
          counters.hits += 1;
          counters.freshHits += 1;
          touch(hit);
          return hit.value;
        }
        if (now < hit.staleUntil) {
          counters.hits += 1;
          counters.staleHits += 1;
          touch(hit);
          if (!inflight.has(key)) {
            load(key, loader).catch(() => {});
          }
          return hit.value;
        }
        remove(key, 'expiration');
      }
      counters.misses += 1;
      return load(key, loader);
    },
    invalidate(key: string) {
      remove(key);
    },
    set(key: string, value: T) {
      write(key, value, Date.now());
    },
    peek(key: string): { value: T; fresh: boolean } | null {
      const now = Date.now();
      const hit = store.get(key);
      if (!hit) {
        counters.misses += 1;
        return null;
      }
      if (now < hit.freshUntil) {
        counters.hits += 1;
        counters.freshHits += 1;
        touch(hit);
        return { value: hit.value, fresh: true };
      }
      if (now < hit.staleUntil) {
        counters.hits += 1;
        counters.staleHits += 1;
        touch(hit);
        return { value: hit.value, fresh: false };
      }
      remove(key, 'expiration');
      counters.misses += 1;
      return null;
    },
    clear() {
      cacheGeneration += 1;
      store.clear();
      inflight.clear();
      estimatedBytes = 0;
    },
    size() {
      cleanupExpired(Date.now());
      return store.size;
    },
    stats: readStats,
    getStats: readStats,
  };
}
