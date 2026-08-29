export function formatDateTime(
  timestamp: number | null | undefined,
): string | undefined {
  if (!timestamp) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}
