import { saveDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  generateStorageKey,
  getCachedPlayRecordsSnapshot,
} from '@/lib/db.client';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const PREFETCH_INTENT_DELAY_MS = 180;

const DETAIL_WARMUP_TTL_MS = 30_000;
const prefetchedDetails = new Map<
  string,
  { expiresAt: number; task: Promise<SearchResult> }
>();
const queuedDetails = new Set<string>();
const searchTasks = new Map<string, Promise<PlaybackSearchResponse>>();

export interface PlaybackSearchResponse {
  results: SearchResult[];
  totalSources?: number;
  failedSources?: unknown[];
}

function detailKey(source: string, id: string) {
  return JSON.stringify([
    getAuthInfoFromBrowserCookie()?.username || '',
    source,
    id,
  ]);
}

export function getSharedPlaybackDetail(
  source: string,
  id: string,
): Promise<SearchResult> | null {
  const key = detailKey(source, id);
  const entry = prefetchedDetails.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    prefetchedDetails.delete(key);
    return null;
  }
  return entry.task;
}

export function fetchSharedPlaybackDetail(
  source: string,
  id: string,
): Promise<SearchResult> {
  const existing = getSharedPlaybackDetail(source, id);
  if (existing) return existing;
  const key = detailKey(source, id);
  const entry = {
    expiresAt: Date.now() + DETAIL_WARMUP_TTL_MS,
    task: null as unknown as Promise<SearchResult>,
  };
  entry.task = fetch(
    `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`,
    { credentials: 'same-origin' },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error('获取视频详情失败');
      const detail = (await response.json()) as SearchResult;
      if (!Array.isArray(detail?.episodes) || !detail.episodes.length)
        throw new Error('无可播放剧集');
      if (key === detailKey(source, id)) saveDetailSnapshot(source, id, detail);
      entry.expiresAt = Date.now() + DETAIL_WARMUP_TTL_MS;
      return detail;
    })
    .catch((error) => {
      if (prefetchedDetails.get(key) === entry) prefetchedDetails.delete(key);
      throw error;
    });
  prefetchedDetails.set(key, entry);
  trimIfNeeded();
  return entry.task;
}

export function getSharedPlaybackSearch(
  query: string,
): Promise<PlaybackSearchResponse> | null {
  const task = searchTasks.get(normalizeSearchWarmupKey(query));
  if (task) return task;
  const results = readSearchWarmupResult(query);
  return results ? Promise.resolve({ results }) : null;
}
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

export function clearPlaybackWarmups(): void {
  prefetchedDetails.clear();
  queuedDetails.clear();
  detailPrefetchQueue.length = 0;
  searchTasks.clear();
  warmedSearchQueries.clear();
  searchWarmupQueue.length = 0;
}

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
  const iter = prefetchedDetails.keys();
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
  if (!getAuthInfoFromBrowserCookie()?.username) return;
  if (!source || !id) return;
  const key = detailKey(source, id);
  if (getSharedPlaybackDetail(source, id) || queuedDetails.has(key)) return;
  queuedDetails.add(key);

  if (detailPrefetchQueue.length >= PREFETCH_DETAIL_QUEUE_MAX) {
    const dropped = detailPrefetchQueue.shift();
    if (dropped) {
      queuedDetails.delete(dropped.key);
    }
  }

  detailPrefetchQueue.push({
    key,
    run: async () => {
      queuedDetails.delete(key);
      if (key !== detailKey(source, id)) return;
      await fetchSharedPlaybackDetail(source, id).catch(() => undefined);
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
  return `${getAuthInfoFromBrowserCookie()?.username || ''}:${query.trim().replace(/\s+/g, ' ').toLowerCase()}`;
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
    const promise = fetch(`/api/search?q=${encodeURIComponent(task.query)}`, {
      credentials: 'same-origin',
    }).then(async (response) => {
      if (!response.ok) throw new Error('播放源搜索失败');
      const data = (await response.json()) as PlaybackSearchResponse;
      if (
        data.totalSources &&
        (data.failedSources?.length || 0) >= data.totalSources &&
        !data.results?.length
      )
        throw new Error('播放源搜索失败');
      if (task.key === normalizeSearchWarmupKey(task.query))
        saveSearchWarmupResult(task.query, data.results || []);
      return data;
    });
    searchTasks.set(task.key, promise);
    void promise
      .catch(() => warmedSearchQueries.delete(task.key))
      .finally(() => {
        searchTasks.delete(task.key);
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
  return normalizeWorkTitle(value || '');
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
      return (
        !normalizeWorkYear(year) ||
        normalizeWorkYear(record.year) === normalizeWorkYear(year)
      );
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
