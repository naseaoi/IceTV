import type { PlayRecord } from '@/lib/types';

export const DEFAULT_RECENT_PLAY_RECORD_LIMIT = 10;
export const MAX_RECENT_PLAY_RECORD_LIMIT = 100;

export function normalizePlayRecordLimit(
  value: unknown,
  fallback = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  const normalizedFallback = Math.min(
    MAX_RECENT_PLAY_RECORD_LIMIT,
    Math.max(1, Math.floor(fallback)),
  );

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return normalizedFallback;
  }

  return Math.min(MAX_RECENT_PLAY_RECORD_LIMIT, Math.floor(parsed));
}

export function selectRecentPlayRecords(
  records: Record<string, PlayRecord>,
  limit = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
): Record<string, PlayRecord> {
  const normalizedLimit = normalizePlayRecordLimit(limit);

  return Object.fromEntries(
    Object.entries(records)
      .sort(([, left], [, right]) => right.save_time - left.save_time)
      .slice(0, normalizedLimit),
  );
}
