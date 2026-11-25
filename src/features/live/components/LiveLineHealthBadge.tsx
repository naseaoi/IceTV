import type { LiveChannel, LiveLineHealthStatus } from '@/features/live/types';

const HEALTH = {
  ok: { label: '可用', color: 'bg-emerald-500 dark:bg-emerald-400' },
  slow: { label: '较慢', color: 'bg-amber-500 dark:bg-amber-400' },
  failed: { label: '异常', color: 'bg-rose-500 dark:bg-rose-400' },
  ended: { label: '已停更', color: 'bg-gray-500 dark:bg-gray-400' },
  unknown: { label: '未检测', color: 'bg-gray-400 dark:bg-gray-500' },
} satisfies Record<LiveLineHealthStatus, { label: string; color: string }>;

export function liveHealthDescription(line: LiveChannel, now = Date.now()) {
  const health = line.health;
  const minutes = health?.checkedAt
    ? Math.max(0, Math.floor((now - health.checkedAt) / 60_000))
    : null;
  return [
    HEALTH[health?.status || 'unknown'].label,
    minutes === null
      ? null
      : minutes === 0
        ? '刚刚检测'
        : `${minutes} 分钟前检测`,
    health?.latencyMs === undefined
      ? null
      : `${Math.round(health.latencyMs)} ms`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function LiveLineHealthBadge({
  line,
  dotOnly = false,
}: {
  line: LiveChannel;
  dotOnly?: boolean;
}) {
  const health = HEALTH[line.health?.status || 'unknown'];
  return (
    <span
      className='inline-flex items-center gap-1.5'
      title={liveHealthDescription(line)}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${health.color}`}
        aria-hidden
      />
      {dotOnly ? <span className='sr-only'>{health.label}</span> : health.label}
    </span>
  );
}
