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

function removeSnapshotKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

export function readDetailSnapshot(
  source: string,
  id: string,
): SearchResult | null {
  if (typeof window === 'undefined' || !source || !id) return null;

  const key = buildSnapshotKey(source, id);
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  const entry = parseSnapshotEntry(raw);
  if (
    !entry ||
    entry.data.episodes.length === 0 ||
    Date.now() - entry.savedAt > SNAPSHOT_TTL_MS
  ) {
    removeSnapshotKey(key);
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

  try {
    window.localStorage.setItem(key, payload);
    pruneDetailSnapshots(SNAPSHOT_MAX_ENTRIES);
  } catch {
    try {
      pruneDetailSnapshots(Math.floor(SNAPSHOT_MAX_ENTRIES / 2));
      window.localStorage.setItem(key, payload);
    } catch {
      // 忽略
    }
  }
}

function pruneDetailSnapshots(maxEntries: number): void {
  const entries: { key: string; savedAt: number }[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(SNAPSHOT_KEY_PREFIX)) continue;
    const entry = parseSnapshotEntry(window.localStorage.getItem(key));
    entries.push({ key, savedAt: entry?.savedAt ?? 0 });
  }
  if (entries.length <= maxEntries) return;

  entries.sort((a, b) => a.savedAt - b.savedAt);
  for (const item of entries.slice(0, entries.length - maxEntries)) {
    removeSnapshotKey(item.key);
  }
}
