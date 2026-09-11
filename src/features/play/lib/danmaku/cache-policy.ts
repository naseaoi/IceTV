export const DANMAKU_EMPTY_CACHE_MS = 30 * 1000;
export const DANMAKU_COMMENTS_FRESH_MS = 2 * 60 * 60 * 1000;
export const DANMAKU_COMMENTS_STALE_MS = 6 * 60 * 60 * 1000;
export const DANMAKU_SEARCH_FRESH_MS = 30 * 60 * 1000;
export const DANMAKU_SEARCH_STALE_MS = 2 * 60 * 60 * 1000;
export const DANMAKU_DEFAULT_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 5 * 60;

export function normalizeDanmakuRetrySeconds(seconds: number): number {
  return Number.isFinite(seconds)
    ? Math.max(1, Math.min(MAX_RETRY_SECONDS, Math.ceil(seconds)))
    : DANMAKU_DEFAULT_RETRY_SECONDS;
}

export function parseDanmakuRetryAfter(value?: string | null): number {
  if (!value?.trim()) return DANMAKU_DEFAULT_RETRY_SECONDS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return normalizeDanmakuRetrySeconds(seconds);
  return normalizeDanmakuRetrySeconds((Date.parse(value) - Date.now()) / 1000);
}
