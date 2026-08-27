import 'server-only';

import type { CoverImageResizeOptions } from '@/lib/cover-image-resize';
import { createSwrCache } from '@/lib/server-cache';

const RESIZE_FRESH_MS = 6 * 60 * 60 * 1000;
const RESIZE_STALE_MS = 6 * 60 * 60 * 1000;
const RESIZE_MAX_SIZE = 1200;
const RESIZE_MAX_BYTES = 48 * 1024 * 1024;

const RESIZED_COVER_CACHE = createSwrCache<ArrayBuffer>({
  name: 'cover-image-resize',
  freshMs: RESIZE_FRESH_MS,
  staleMs: RESIZE_STALE_MS,
  maxSize: RESIZE_MAX_SIZE,
  maxWeightBytes: RESIZE_MAX_BYTES,
  estimateWeight: (value) => value.byteLength,
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
