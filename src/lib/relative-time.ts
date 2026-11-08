const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
): string {
  if (!timestamp) return '最近';
  const elapsed = now - timestamp;
  if (elapsed < MINUTE_MS) return '刚刚';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时前`;

  const sameYear =
    new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat('zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp);
}
