export const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
export const MAX_MESSAGE_PAGE_LIMIT = 50;

export function normalizeMessageLimit(value: string | number | null): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGE_PAGE_LIMIT;
  }
  return Math.min(MAX_MESSAGE_PAGE_LIMIT, Math.floor(parsed));
}
