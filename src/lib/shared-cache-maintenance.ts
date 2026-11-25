export const SHARED_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const SHARED_CACHE_MAX_ENTRIES = 4096;
export const SHARED_CACHE_MAX_BYTES = 128 * 1024 * 1024;
export const SHARED_CACHE_PRUNE_BATCH_SIZE = 250;
export const SHARED_CACHE_PRUNE_MAX_BATCHES = 40;
export const SHARED_CACHE_PRUNE_MAX_MS = 250;

export interface SharedCacheMetadata {
  cache_key: string;
  updated_at: number;
  value_bytes: number | null;
}

// 旧行完成精确回填后才启用字节裁剪，避免升级时高估体积引发集中回源。
export function sharedCacheOverflowBoundary(rows: SharedCacheMetadata[]) {
  const bytesKnown = rows.every((row) => row.value_bytes !== null);
  let bytes = 0;
  return rows.find((row, index) => {
    bytes += Number(row.value_bytes ?? 0);
    return (
      index >= SHARED_CACHE_MAX_ENTRIES ||
      (bytesKnown && bytes > SHARED_CACHE_MAX_BYTES)
    );
  });
}

export async function pruneSharedCacheBatches(
  limit: number,
  expire: (batchSize: number) => Promise<number>,
  readMetadata: () => Promise<SharedCacheMetadata[]>,
  trim: (boundary: SharedCacheMetadata, batchSize: number) => Promise<number>,
  backfill: (keys: string[]) => Promise<void>,
): Promise<void> {
  const batchSize = Number.isFinite(limit)
    ? Math.max(1, Math.min(SHARED_CACHE_PRUNE_BATCH_SIZE, Math.floor(limit)))
    : SHARED_CACHE_PRUNE_BATCH_SIZE;
  const startedAt = performance.now();
  let batches = 0;
  const available = () =>
    batches < SHARED_CACHE_PRUNE_MAX_BATCHES &&
    performance.now() - startedAt < SHARED_CACHE_PRUNE_MAX_MS;
  const yieldTurn = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));
  while (available()) {
    const deleted = await expire(batchSize);
    batches += 1;
    if (deleted < batchSize) break;
    await yieldTurn();
  }
  if (!available()) return;
  async function trimOverflow(rows: SharedCacheMetadata[]) {
    const boundary = sharedCacheOverflowBoundary(rows);
    if (!boundary) return;
    while (available()) {
      const deleted = await trim(boundary, batchSize);
      batches += 1;
      if (deleted < batchSize) break;
      await yieldTurn();
    }
  }

  const rows = await readMetadata();
  // 条数裁剪先于回填，旧行积压时同样遵守条数目标。
  await trimOverflow(rows);
  const legacyKeys = rows
    .filter((row) => row.value_bytes === null)
    .map((row) => row.cache_key);
  for (
    let offset = 0;
    offset < legacyKeys.length && available();
    offset += batchSize
  ) {
    await backfill(legacyKeys.slice(offset, offset + batchSize));
    batches += 1;
    await yieldTurn();
  }
  if (legacyKeys.length > 0 && available())
    await trimOverflow(await readMetadata());
}
