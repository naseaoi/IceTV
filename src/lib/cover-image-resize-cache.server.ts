import 'server-only';

import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import type { CoverImageResizeOptions } from '@/lib/cover-image-resize';
import { createSharedServerCache } from '@/lib/shared-server-cache';

const RESIZE_FRESH_MS = 6 * 60 * 60 * 1000;
const RESIZE_STALE_MS = 6 * 60 * 60 * 1000;

const RESIZED_COVER_CACHE = createSharedServerCache<ArrayBuffer>({
  name: 'cover-image-resize',
  freshMs: RESIZE_FRESH_MS,
  staleMs: RESIZE_STALE_MS,
  ...getServerCacheBudget('cover-image-resize'),
  estimateWeight: (value) => value.byteLength,
  serialize: (value) => Buffer.from(value).toString('base64'),
  deserialize: (value) => Uint8Array.from(Buffer.from(value, 'base64')).buffer,
  maxWaitMs: 12_000,
});

function makeResizedCoverCacheKey(
  url: string,
  options: CoverImageResizeOptions,
): string {
  return `${options.width}::${options.quality}::${url}`;
}

export function loadResizedCoverImage(
  url: string,
  options: CoverImageResizeOptions,
  loader: () => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  return RESIZED_COVER_CACHE.getOrLoad(
    makeResizedCoverCacheKey(url, options),
    loader,
  );
}

export function getResizedCoverCacheStats() {
  return RESIZED_COVER_CACHE.stats();
}

export function clearResizedCoverCacheForTests(): void {
  RESIZED_COVER_CACHE.clear();
}
