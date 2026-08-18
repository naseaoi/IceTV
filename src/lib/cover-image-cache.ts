import { getRuntimeConfig } from '@/lib/runtime-config';

const STORAGE_KEY = 'icetv:cover-image-loaded';
const FAILED_STORAGE_KEY = 'icetv:cover-image-failed';
const DEFAULT_CACHE_MAX_SIZE = 500;
const LOADED_EVENT = 'loaded';
export const COVER_IMAGE_FAILURE_TTL_MS = 10 * 60 * 1000;

const loadedImageCache = new Map<string, number>();
const failedImageCache = new Map<string, number>();
const imageLoadEmitter =
  typeof EventTarget === 'undefined' ? null : new EventTarget();
let storageHydrated = false;
let failedStorageHydrated = false;
let persistScheduled = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistIdleHandle: number | null = null;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function normalizeKeys(keys: string[]): string[] {
  return Array.from(
    new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0)),
  );
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getCacheMaxSize(): number {
  return Math.max(
    50,
    Math.floor(
      getRuntimeConfig()?.COVER_IMAGE_CACHE_SIZE || DEFAULT_CACHE_MAX_SIZE,
    ),
  );
}

function hydrateCacheFromStorage(
  storageKey: string,
  cache: Map<string, number>,
) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return;
    }

    for (const item of parsed) {
      if (Array.isArray(item) && typeof item[0] === 'string') {
        const timestamp =
          typeof item[1] === 'number' && Number.isFinite(item[1])
            ? item[1]
            : Date.now();
        cache.set(item[0], timestamp);
      } else if (typeof item === 'string') {
        cache.set(item, Date.now());
      }
    }
  } catch {
    storage.removeItem(storageKey);
  }
}

function hydrateFromStorage() {
  if (storageHydrated) {
    return;
  }

  storageHydrated = true;
  hydrateCacheFromStorage(STORAGE_KEY, loadedImageCache);
}

function hydrateFailedFromStorage() {
  if (failedStorageHydrated) {
    return;
  }

  failedStorageHydrated = true;
  hydrateCacheFromStorage(FAILED_STORAGE_KEY, failedImageCache);
}

function trimCache(cache: Map<string, number>) {
  const cacheMaxSize = getCacheMaxSize();
  if (cache.size <= cacheMaxSize) {
    return;
  }

  const trimToSize = Math.max(1, Math.floor(cacheMaxSize / 2));
  const evictCount = cache.size - trimToSize;
  const cacheKeys = Array.from(cache.keys());
  for (
    let index = 0;
    index < evictCount && index < cacheKeys.length;
    index += 1
  ) {
    cache.delete(cacheKeys[index]);
  }
}

function persistToStorage() {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...loadedImageCache]));
    storage.setItem(FAILED_STORAGE_KEY, JSON.stringify([...failedImageCache]));
  } catch {}
}

function schedulePersistToStorage() {
  if (persistScheduled) {
    return;
  }

  persistScheduled = true;
  const persist = () => {
    persistScheduled = false;
    persistTimer = null;
    persistIdleHandle = null;
    persistToStorage();
  };

  if (typeof window !== 'undefined') {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      persistIdleHandle = idleWindow.requestIdleCallback(persist, {
        timeout: 1000,
      });
      return;
    }
  }

  persistTimer = setTimeout(persist, 200);
}

function cancelScheduledPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  if (persistIdleHandle !== null && typeof window !== 'undefined') {
    const idleWindow = window as IdleWindow;
    idleWindow.cancelIdleCallback?.(persistIdleHandle);
    persistIdleHandle = null;
  }

  persistScheduled = false;
}

function emitLoaded(key: string) {
  if (!imageLoadEmitter) {
    return;
  }

  if (typeof CustomEvent === 'function') {
    imageLoadEmitter.dispatchEvent(
      new CustomEvent(LOADED_EVENT, { detail: key }),
    );
    return;
  }

  const event = new Event(LOADED_EVENT) as CustomEvent<string>;
  Object.defineProperty(event, 'detail', { value: key });
  imageLoadEmitter.dispatchEvent(event);
}

export function markCoverImagesLoaded(keys: string[]) {
  const cacheKeys = normalizeKeys(keys);
  if (cacheKeys.length === 0) {
    return;
  }

  hydrateFromStorage();
  hydrateFailedFromStorage();
  const now = Date.now();
  for (const key of cacheKeys) {
    failedImageCache.delete(key);
    loadedImageCache.delete(key);
    loadedImageCache.set(key, now);
  }

  trimCache(loadedImageCache);
  schedulePersistToStorage();
  for (const key of cacheKeys) {
    emitLoaded(key);
  }
}

export function isCoverImageCached(
  keys: string[],
  options: { includePersistent?: boolean } = {},
): boolean {
  const cacheKeys = normalizeKeys(keys);
  if (cacheKeys.length === 0) {
    return false;
  }

  if (options.includePersistent !== false) {
    hydrateFromStorage();
  }

  const hitKey = cacheKeys.find((key) => loadedImageCache.has(key));
  if (!hitKey) {
    return false;
  }

  const cachedAt = loadedImageCache.get(hitKey) ?? Date.now();
  for (const key of cacheKeys) {
    loadedImageCache.delete(key);
    loadedImageCache.set(key, cachedAt);
  }

  trimCache(loadedImageCache);
  return true;
}

export function markCoverImagesFailed(keys: string[]) {
  const cacheKeys = normalizeKeys(keys);
  if (cacheKeys.length === 0) {
    return;
  }

  hydrateFromStorage();
  hydrateFailedFromStorage();
  const now = Date.now();
  for (const key of cacheKeys) {
    loadedImageCache.delete(key);
    failedImageCache.delete(key);
    failedImageCache.set(key, now);
  }

  trimCache(failedImageCache);
  schedulePersistToStorage();
}

export function isCoverImageFailed(keys: string[]): boolean {
  const cacheKeys = normalizeKeys(keys);
  if (cacheKeys.length === 0) {
    return false;
  }

  hydrateFailedFromStorage();
  const now = Date.now();
  let hitKey: string | undefined;

  for (const key of cacheKeys) {
    const failedAt = failedImageCache.get(key);
    if (failedAt === undefined) {
      continue;
    }
    if (now - failedAt >= COVER_IMAGE_FAILURE_TTL_MS) {
      failedImageCache.delete(key);
      continue;
    }
    hitKey = key;
    break;
  }

  return hitKey !== undefined;
}

export function subscribeCoverImageLoaded(
  keys: string[],
  onLoaded: () => void,
): () => void {
  const cacheKeys = normalizeKeys(keys);
  if (!imageLoadEmitter || cacheKeys.length === 0) {
    return () => {};
  }

  const keySet = new Set(cacheKeys);
  const handler = (event: Event) => {
    if (keySet.has((event as CustomEvent<string>).detail)) {
      onLoaded();
    }
  };

  imageLoadEmitter.addEventListener(LOADED_EVENT, handler);
  return () => imageLoadEmitter.removeEventListener(LOADED_EVENT, handler);
}

export function clearCoverImageCacheForTests() {
  cancelScheduledPersist();
  loadedImageCache.clear();
  failedImageCache.clear();
  storageHydrated = false;
  failedStorageHydrated = false;
  getSessionStorage()?.removeItem(STORAGE_KEY);
  getSessionStorage()?.removeItem(FAILED_STORAGE_KEY);
}

export function flushCoverImageCacheForTests() {
  cancelScheduledPersist();
  persistToStorage();
}
