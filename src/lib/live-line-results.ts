import { readStorage, writeStorage } from '@/lib/browser-storage';

export const LIVE_LINE_RESULTS_STORAGE_KEY = 'liveLineResults';
export const LIVE_LINE_RESULT_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;
export interface LiveLineResult {
  ok: boolean;
  at: number;
}

export function readLiveLineResults(
  now = Date.now(),
): ReadonlyMap<string, LiveLineResult> {
  try {
    const parsed: unknown = JSON.parse(
      readStorage(LIVE_LINE_RESULTS_STORAGE_KEY) || '[]',
    );
    if (!Array.isArray(parsed)) return new Map();
    const entries = parsed.filter(
      (entry): entry is [string, LiveLineResult] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[0].length > 0 &&
        entry[1] &&
        typeof entry[1].ok === 'boolean' &&
        Number.isFinite(entry[1].at) &&
        entry[1].at <= now &&
        now - entry[1].at < LIVE_LINE_RESULT_TTL_MS,
    );
    return new Map(
      entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES),
    );
  } catch {
    return new Map();
  }
}

export function recordLiveLineResult(
  lineId: string,
  ok: boolean,
  now = Date.now(),
): void {
  // 旧服务端缺少稳定指纹时跳过持久化，避免按订阅序号污染其他线路。
  if (!lineId) return;
  const entries = new Map(readLiveLineResults(now));
  entries.set(lineId, { ok, at: now });
  writeStorage(
    LIVE_LINE_RESULTS_STORAGE_KEY,
    JSON.stringify(
      [...entries].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES),
    ),
  );
}
