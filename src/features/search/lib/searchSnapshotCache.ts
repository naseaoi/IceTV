import { createSwrCache } from '@/lib/server-cache';
import type { SearchResult } from '@/lib/types';

export interface SearchSnapshot {
  results: SearchResult[];
  totalSources: number;
  completedSources: number;
  useFluidSearch: boolean;
}

const SEARCH_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const SEARCH_SNAPSHOT_MAX_ENTRIES = 12;
const SEARCH_SNAPSHOT_MAX_BYTES = 24 * 1024 * 1024;
const searchSnapshotCache = createSwrCache<SearchSnapshot>({
  name: 'client-search-snapshots',
  maxSize: SEARCH_SNAPSHOT_MAX_ENTRIES,
  maxWeightBytes: SEARCH_SNAPSHOT_MAX_BYTES,
  freshMs: SEARCH_SNAPSHOT_TTL_MS,
  staleMs: 0,
});

function getSearchSnapshotCacheKey(query: string) {
  return query.trim().toLowerCase();
}

export function getSearchSnapshot(query: string): SearchSnapshot | null {
  return (
    searchSnapshotCache.peek(getSearchSnapshotCacheKey(query))?.value || null
  );
}

export function setSearchSnapshot(
  query: string,
  snapshot: SearchSnapshot,
): void {
  searchSnapshotCache.set(getSearchSnapshotCacheKey(query), snapshot);
}

export function clearSearchSnapshotCache(query?: string): void {
  if (query) {
    searchSnapshotCache.invalidate(getSearchSnapshotCacheKey(query));
  } else {
    searchSnapshotCache.clear();
  }
}

export function getSearchSnapshotCacheStats() {
  return searchSnapshotCache.stats();
}
