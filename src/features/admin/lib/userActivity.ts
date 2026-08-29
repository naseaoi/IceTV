import { formatDateTime } from '@/features/admin/lib/formatDateTime';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const NEVER_ACTIVE_TEXT = '从未活跃';

export function formatLastActive(timestamp: number | undefined): string {
  if (!timestamp) return NEVER_ACTIVE_TEXT;

  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE_MS) return '刚刚';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时前`;
  if (elapsed < 30 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)} 天前`;

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

export function formatLastActiveTooltip(
  timestamp: number | null | undefined,
): string | undefined {
  return formatDateTime(timestamp);
}

export function getInactiveDays(
  timestamp: number | undefined,
  now = Date.now(),
): number | null {
  if (!timestamp) return null;
  return Math.floor((now - timestamp) / DAY_MS);
}
