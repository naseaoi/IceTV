export interface CacheBudgetEntry<Key> {
  key: Key;
  bytes: number;
}

export interface CacheBudgetOptions {
  maxEntries: number;
  maxBytes: number;
}

export function createCacheBudgetLedger<Key>(options: CacheBudgetOptions) {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries));
  const maxBytes = Math.max(0, Math.floor(options.maxBytes));
  const entries = new Map<Key, number>();
  let totalBytes = 0;
  let initialized = false;

  function remove(key: Key): boolean {
    const bytes = entries.get(key);
    if (bytes === undefined) return false;
    entries.delete(key);
    totalBytes = Math.max(0, totalBytes - bytes);
    return true;
  }

  return {
    initialize(initialEntries: Iterable<CacheBudgetEntry<Key>>): void {
      entries.clear();
      totalBytes = 0;
      for (const entry of initialEntries) {
        if (!Number.isFinite(entry.bytes) || entry.bytes <= 0) continue;
        remove(entry.key);
        const bytes = Math.floor(entry.bytes);
        entries.set(entry.key, bytes);
        totalBytes += bytes;
      }
      initialized = true;
    },
    isInitialized(): boolean {
      return initialized;
    },
    reserve(key: Key, requestedBytes: number): Key[] {
      const bytes = Math.max(0, Math.floor(requestedBytes));
      remove(key);
      const evicted: Key[] = [];

      while (
        entries.size > 0 &&
        (entries.size >= maxEntries || totalBytes + bytes > maxBytes)
      ) {
        const oldestKey = entries.keys().next().value as Key;
        remove(oldestKey);
        evicted.push(oldestKey);
      }

      entries.set(key, bytes);
      totalBytes += bytes;
      return evicted;
    },
    stats(): { initialized: boolean; entries: number; totalBytes: number } {
      return { initialized, entries: entries.size, totalBytes };
    },
  };
}
