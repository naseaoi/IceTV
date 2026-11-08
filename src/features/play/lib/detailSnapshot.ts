import {
  listStorageKeys,
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';
import type { SearchResult } from '@/lib/types';

const SNAPSHOT_KEY_PREFIX = 'icetv-detail-snapshot:';
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_MAX_ENTRIES = 30;

interface DetailSnapshotEntry {
  data: SearchResult;
  savedAt: number;
}

function buildSnapshotKey(source: string, id: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${source}:${id}`;
}

function parseSnapshotEntry(raw: string | null): DetailSnapshotEntry | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as DetailSnapshotEntry;
    if (!entry || typeof entry.savedAt !== 'number') return null;
    if (!entry.data || !Array.isArray(entry.data.episodes)) return null;
    return entry;
  } catch {
    return null;
  }
}

export function readDetailSnapshot(
  source: string,
  id: string,
): SearchResult | null {
  if (typeof window === 'undefined' || !source || !id) return null;

  const key = buildSnapshotKey(source, id);
  const raw = readStorage(key);
  if (!raw) return null;

  const entry = parseSnapshotEntry(raw);
  if (
    !entry ||
    entry.data.episodes.length === 0 ||
    Date.now() - entry.savedAt > SNAPSHOT_TTL_MS
  ) {
    removeStorage(key);
    return null;
  }
  return entry.data;
}

export function saveDetailSnapshot(
  source: string,
  id: string,
  data: SearchResult,
): void {
  if (typeof window === 'undefined' || !source || !id) return;
  if (!data?.episodes || data.episodes.length === 0) return;

  const key = buildSnapshotKey(source, id);
  const payload = JSON.stringify({
    data,
    savedAt: Date.now(),
  } satisfies DetailSnapshotEntry);

  if (writeStorage(key, payload)) {
    pruneDetailSnapshots(SNAPSHOT_MAX_ENTRIES);
    return;
  }
  pruneDetailSnapshots(Math.floor(SNAPSHOT_MAX_ENTRIES / 2));
  writeStorage(key, payload);
}

function pruneDetailSnapshots(maxEntries: number): void {
  const entries = listStorageKeys(SNAPSHOT_KEY_PREFIX).map((key) => ({
    key,
    savedAt: parseSnapshotEntry(readStorage(key))?.savedAt ?? 0,
  }));
  if (entries.length <= maxEntries) return;

  entries.sort((a, b) => a.savedAt - b.savedAt);
  for (const item of entries.slice(0, entries.length - maxEntries)) {
    removeStorage(item.key);
  }
}
