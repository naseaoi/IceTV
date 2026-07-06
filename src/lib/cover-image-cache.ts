import { getRuntimeConfig } from '@/lib/runtime-config';

const STORAGE_KEY = 'icetv:cover-image-loaded';
const DEFAULT_CACHE_MAX_SIZE = 500;
const LOADED_EVENT = 'loaded';

const loadedImageCache = new Map<string, number>();
const imageLoadEmitter =
  typeof EventTarget === 'undefined' ? null : new EventTarget();
let storageHydrated = false;
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

function hydrateFromStorage() {
  if (storageHydrated) {
    return;
  }

  storageHydrated = true;
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
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
        loadedImageCache.set(item[0], timestamp);
      } else if (typeof item === 'string') {
        loadedImageCache.set(item, Date.now());
      }
    }
  } catch {
    storage.removeItem(STORAGE_KEY);
  }
}

function trimCache() {
  const cacheMaxSize = getCacheMaxSize();
  if (loadedImageCache.size <= cacheMaxSize) {
    return;
  }

  const trimToSize = Math.max(1, Math.floor(cacheMaxSize / 2));
  const evictCount = loadedImageCache.size - trimToSize;
  const cacheKeys = Array.from(loadedImageCache.keys());
  for (
    let index = 0;
    index < evictCount && index < cacheKeys.length;
    index += 1
  ) {
    loadedImageCache.delete(cacheKeys[index]);
  }
}

function persistToStorage() {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...loadedImageCache]));
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
  const now = Date.now();
  for (const key of cacheKeys) {
    loadedImageCache.delete(key);
    loadedImageCache.set(key, now);
  }

  trimCache();
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

  trimCache();
  return true;
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
  storageHydrated = false;
  getSessionStorage()?.removeItem(STORAGE_KEY);
}

export function flushCoverImageCacheForTests() {
  cancelScheduledPersist();
  persistToStorage();
}
