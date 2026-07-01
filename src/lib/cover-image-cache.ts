const STORAGE_KEY = 'icetv:cover-image-loaded';
const CACHE_MAX_SIZE = 500;
const CACHE_TRIM_TO_SIZE = 250;
const LOADED_EVENT = 'loaded';

const loadedImageCache = new Map<string, number>();
const imageLoadEmitter =
  typeof EventTarget === 'undefined' ? null : new EventTarget();
let storageHydrated = false;

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
  if (loadedImageCache.size <= CACHE_MAX_SIZE) {
    return;
  }

  const evictCount = loadedImageCache.size - CACHE_TRIM_TO_SIZE;
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
  persistToStorage();
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

  const shouldPersist = options.includePersistent !== false;
  const cachedAt = loadedImageCache.get(hitKey) ?? Date.now();
  for (const key of cacheKeys) {
    loadedImageCache.delete(key);
    loadedImageCache.set(key, cachedAt);
  }

  trimCache();
  if (shouldPersist) {
    persistToStorage();
  }
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
  loadedImageCache.clear();
  storageHydrated = false;
  getSessionStorage()?.removeItem(STORAGE_KEY);
}
