export const MIN_INACTIVE_DAYS = 1;
export const MAX_INACTIVE_DAYS = 3650;

export function parseInactiveDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const days = Math.floor(value);
  if (days < MIN_INACTIVE_DAYS || days > MAX_INACTIVE_DAYS) return null;
  return days;
}
