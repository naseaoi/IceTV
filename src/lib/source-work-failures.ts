import { readStorage, writeStorage } from '@/lib/browser-storage';

export const SOURCE_WORK_FAILURES_STORAGE_KEY = 'sourceWorkFailures';

const VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export function sourceWorkFailureKey(source: string, id: string): string {
  return JSON.stringify([source, id]);
}

function isValidKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  try {
    const pair: unknown = JSON.parse(key);
    return (
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every((part) => typeof part === 'string' && part.length > 0) &&
      pair[0].length <= 64 &&
      key === sourceWorkFailureKey(pair[0], pair[1])
    );
  } catch {
    return false;
  }
}

function readEntries(now: number): Map<string, number> {
  try {
    const raw = readStorage(SOURCE_WORK_FAILURES_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (parsed?.v !== VERSION || !Array.isArray(parsed.entries)) {
      return new Map();
    }
    const entries = new Map<string, number>();
    for (const item of parsed.entries) {
      if (
        !Array.isArray(item) ||
        item.length !== 2 ||
        !isValidKey(item[0]) ||
        typeof item[1] !== 'number' ||
        !Number.isFinite(item[1]) ||
        item[1] < 0 ||
        item[1] > now ||
        now - item[1] >= TTL_MS
      )
        continue;
      entries.set(item[0], Math.max(entries.get(item[0]) ?? 0, item[1]));
    }
    return new Map(
      [...entries].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES),
    );
  } catch {
    return new Map();
  }
}

function writeEntries(entries: Map<string, number>): void {
  // 存储不可用时放弃记忆，保持播放流程可用。
  writeStorage(
    SOURCE_WORK_FAILURES_STORAGE_KEY,
    JSON.stringify({
      v: VERSION,
      entries: [...entries].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES),
    }),
  );
}

export function readSourceWorkFailures(now = Date.now()): ReadonlySet<string> {
  return new Set(readEntries(now).keys());
}

export function recordSourceWorkFailure(source: string, id: string): void {
  const key = sourceWorkFailureKey(source, id);
  if (!isValidKey(key)) return;
  const now = Date.now();
  const entries = readEntries(now);
  entries.set(key, now);
  writeEntries(entries);
}

export function recordSourceWorkSuccess(source: string, id: string): void {
  const entries = readEntries(Date.now());
  if (entries.delete(sourceWorkFailureKey(source, id))) writeEntries(entries);
}
