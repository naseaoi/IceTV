import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  generateStorageKey,
  getCachedPlayRecordsSnapshot,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const PREFETCH_INTENT_DELAY_MS = 180;

const prefetchedDetails = new Set<string>();
const PREFETCH_DETAIL_MAX = 200;
const PREFETCH_DETAIL_CONCURRENCY = 3;
const PREFETCH_DETAIL_QUEUE_MAX = 20;

const SEARCH_WARMUP_TTL_MS = 90 * 1000;
const SEARCH_WARMUP_MAX = 50;
const SEARCH_WARMUP_CONCURRENCY = 2;
const SEARCH_WARMUP_QUEUE_MAX = 8;
const SEARCH_WARMUP_STORAGE_KEY = 'icetv_search_warmups_v1';
const SEARCH_WARMUP_STORAGE_MAX = 6;
const SEARCH_WARMUP_RESULT_MAX = 30;
const warmedSearchQueries = new Map<string, number>();
const activeSearchWarmups = new Set<string>();
const searchWarmupQueue: Array<{ key: string; query: string }> = [];

interface SearchWarmupEntry {
  key: string;
  query: string;
  savedAt: number;
  results: SearchResult[];
}

interface LocalPlaybackTarget {
  source: string;
  id: string;
}

export function canUseNetworkPrefetch(): boolean {
  if (typeof window === 'undefined') return false;

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData) return false;
  return !['slow-2g', '2g'].includes(connection?.effectiveType || '');
}

export function canUseHoverPrefetch(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return false;
  }
  return canUseNetworkPrefetch();
}

let activeDetailPrefetches = 0;
const detailPrefetchQueue: Array<{
  key: string;
  run: () => Promise<void>;
}> = [];

function trimIfNeeded() {
  if (prefetchedDetails.size <= PREFETCH_DETAIL_MAX) return;
  const iter = prefetchedDetails.values();
  const toRemove = Math.floor(PREFETCH_DETAIL_MAX / 2);
  for (let i = 0; i < toRemove; i++) {
    const next = iter.next();
    if (next.done) break;
    prefetchedDetails.delete(next.value);
  }
}

function drainDetailPrefetchQueue() {
  while (
    activeDetailPrefetches < PREFETCH_DETAIL_CONCURRENCY &&
    detailPrefetchQueue.length > 0
  ) {
    const task = detailPrefetchQueue.shift();
    if (!task) return;

    activeDetailPrefetches += 1;
    task.run().finally(() => {
      activeDetailPrefetches -= 1;
      drainDetailPrefetchQueue();
    });
  }
}

function prefetchVideoDetail(
  source: string | undefined,
  id: string | undefined,
): void {
  if (!source || !id) return;
  const key = `${source}::${id}`;
  if (prefetchedDetails.has(key)) return;

  prefetchedDetails.add(key);
  trimIfNeeded();

  if (detailPrefetchQueue.length >= PREFETCH_DETAIL_QUEUE_MAX) {
    const dropped = detailPrefetchQueue.shift();
    if (dropped) {
      prefetchedDetails.delete(dropped.key);
    }
  }

  detailPrefetchQueue.push({
    key,
    run: async () => {
      await fetch(
        `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`,
        { credentials: 'same-origin' },
      ).catch(() => {
        prefetchedDetails.delete(key);
      });
    },
  });
  drainDetailPrefetchQueue();
}

export function warmupForPlayback(
  source: string | undefined,
  id: string | undefined,
): void {
  prefetchVideoDetail(source, id);
}

function trimWarmedSearchQueries() {
  if (warmedSearchQueries.size <= SEARCH_WARMUP_MAX) return;
  const oldest = warmedSearchQueries.keys().next().value;
  if (oldest) warmedSearchQueries.delete(oldest);
}

function normalizeSearchWarmupKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function readSearchWarmupEntries(): SearchWarmupEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = sessionStorage.getItem(SEARCH_WARMUP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchWarmupEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        typeof entry?.key === 'string' &&
        typeof entry?.query === 'string' &&
        typeof entry?.savedAt === 'number' &&
        Array.isArray(entry?.results) &&
        Date.now() - entry.savedAt < SEARCH_WARMUP_TTL_MS,
    );
  } catch {
    return [];
  }
}

function writeSearchWarmupEntries(entries: SearchWarmupEntry[]) {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(
      SEARCH_WARMUP_STORAGE_KEY,
      JSON.stringify(entries.slice(0, SEARCH_WARMUP_STORAGE_MAX)),
    );
  } catch {
    sessionStorage.removeItem(SEARCH_WARMUP_STORAGE_KEY);
  }
}

function saveSearchWarmupResult(query: string, results: SearchResult[]) {
  if (results.length === 0) return;

  const key = normalizeSearchWarmupKey(query);
  const entries = readSearchWarmupEntries().filter(
    (entry) => entry.key !== key,
  );
  entries.unshift({
    key,
    query,
    savedAt: Date.now(),
    results: results.slice(0, SEARCH_WARMUP_RESULT_MAX),
  });
  writeSearchWarmupEntries(entries);
}

function readSearchWarmupResult(query: string): SearchResult[] | null {
  const key = normalizeSearchWarmupKey(query);
  const entry = readSearchWarmupEntries().find((item) => item.key === key);
  return entry?.results?.length ? entry.results : null;
}

function drainSearchWarmupQueue() {
  while (
    activeSearchWarmups.size < SEARCH_WARMUP_CONCURRENCY &&
    searchWarmupQueue.length > 0
  ) {
    const task = searchWarmupQueue.shift();
    if (!task) return;

    activeSearchWarmups.add(task.key);
    fetch(`/api/search?q=${encodeURIComponent(task.query)}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) {
          warmedSearchQueries.delete(task.key);
          return;
        }
        const data = (await response.json()) as { results?: SearchResult[] };
        saveSearchWarmupResult(task.query, data.results || []);
      })
      .catch(() => {
        warmedSearchQueries.delete(task.key);
      })
      .finally(() => {
        activeSearchWarmups.delete(task.key);
        drainSearchWarmupQueue();
      });
  }
}

export function warmupSearchForTitle(title: string | undefined): void {
  if (typeof window === 'undefined') return;
  if (!getAuthInfoFromBrowserCookie()?.username) return;

  const query = (title || '').trim();
  if (!query) return;

  const key = normalizeSearchWarmupKey(query);
  const now = Date.now();
  const warmedAt = warmedSearchQueries.get(key);
  if (warmedAt && now - warmedAt < SEARCH_WARMUP_TTL_MS) return;
  if (readSearchWarmupResult(query)) {
    warmedSearchQueries.set(key, now);
    trimWarmedSearchQueries();
    return;
  }

  warmedSearchQueries.set(key, now);
  trimWarmedSearchQueries();

  if (searchWarmupQueue.length >= SEARCH_WARMUP_QUEUE_MAX) {
    const dropped = searchWarmupQueue.shift();
    if (dropped) warmedSearchQueries.delete(dropped.key);
  }

  searchWarmupQueue.push({ key, query });
  drainSearchWarmupQueue();
}

export function transferWarmedSearchToAggregateGroup(
  title: string | undefined,
): boolean {
  if (typeof window === 'undefined') return false;

  const query = (title || '').trim();
  if (!query) return false;

  const results = readSearchWarmupResult(query);
  if (!results) return false;

  try {
    sessionStorage.setItem('aggregate_group', JSON.stringify(results));
    return true;
  } catch {
    return false;
  }
}

function normalizeTitle(value: string | undefined): string {
  return (value || '').trim().replace(/\s+/g, '').toLowerCase();
}

export function findLocalPlaybackTargetByTitle(
  title: string | undefined,
  year?: string,
): LocalPlaybackTarget | null {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return null;

  const records = getCachedPlayRecordsSnapshot();
  if (!records) return null;

  const matched = Object.entries(records)
    .map(([key, record]) => ({ key, record }))
    .filter(({ record }) => {
      if (normalizeTitle(record.title) !== normalizedTitle) return false;
      if (!year || !record.year) return true;
      return record.year === year;
    })
    .sort((a, b) => b.record.save_time - a.record.save_time)[0];

  if (!matched) return null;

  const parsedKey = parseStorageKey(matched.key);
  if (!parsedKey) return null;
  if (generateStorageKey(parsedKey.source, parsedKey.id) !== matched.key) {
    return null;
  }

  return parsedKey;
}
