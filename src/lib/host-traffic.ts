export const TRAFFIC_WARN_RATIO = 0.8;
export const TRAFFIC_PAUSE_RATIO = 0.95;
export const TRAFFIC_STALE_MS = 30 * 60 * 1000;
export const TRAFFIC_MIN_PROJECTION_MS = 6 * 60 * 60 * 1000;
export const TRAFFIC_GB = 1_000_000_000;
export const TRAFFIC_RESET_DAY_MAX = 28;
export const TRAFFIC_QUOTA_GB_MAX = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrafficSettings {
  QuotaGB: number;
  ResetDay: number;
  // 站长手动恢复中转时所在周期的起始日，周期切换后自然失效
  RelayResumedCycle?: string;
}

export const DEFAULT_TRAFFIC_SETTINGS: TrafficSettings = {
  QuotaGB: 0,
  ResetDay: 1,
};

export interface TrafficDay {
  date: string;
  rx: number;
  tx: number;
}

export interface TrafficSnapshot {
  days: TrafficDay[];
  updatedAt: number;
}

export type TrafficRelayState = 'active' | 'paused' | 'resumed';

export interface HostTrafficStatus {
  available: boolean;
  updatedAt: number | null;
  stale: boolean;
  cycleStart: string;
  cycleEnd: string;
  rxBytes: number;
  txBytes: number;
  usedBytes: number;
  todayBytes: number;
  quotaBytes: number;
  usedRatio: number | null;
  projectedBytes: number | null;
  relay: TrafficRelayState;
}

export function normalizeTrafficSettings(value: unknown): TrafficSettings {
  const raw =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof TrafficSettings, unknown>>)
      : {};
  const quota = Number(raw.QuotaGB);
  const resetDay = Number(raw.ResetDay);
  const settings: TrafficSettings = {
    QuotaGB:
      Number.isFinite(quota) && quota > 0
        ? Math.min(Math.round(quota), TRAFFIC_QUOTA_GB_MAX)
        : 0,
    ResetDay:
      Number.isInteger(resetDay) &&
      resetDay >= 1 &&
      resetDay <= TRAFFIC_RESET_DAY_MAX
        ? resetDay
        : DEFAULT_TRAFFIC_SETTINGS.ResetDay,
  };
  if (
    typeof raw.RelayResumedCycle === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.RelayResumedCycle)
  ) {
    settings.RelayResumedCycle = raw.RelayResumedCycle;
  }
  return settings;
}

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// 解析 `vnstat --json d` 输出（jsonversion 2，单位字节），多个网卡按日合计
export function parseVnstatDaily(raw: unknown): {
  days: TrafficDay[];
  updatedAt: number | null;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const interfaces = (raw as { interfaces?: unknown }).interfaces;
  if (!Array.isArray(interfaces) || interfaces.length === 0) return null;
  const byDate = new Map<string, TrafficDay>();
  let updatedAt: number | null = null;
  for (const item of interfaces) {
    const days = item?.traffic?.day;
    if (!Array.isArray(days)) continue;
    const timestamp = Number(item?.updated?.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      updatedAt = Math.max(updatedAt ?? 0, timestamp * 1000);
    }
    for (const day of days) {
      const { year, month, day: dayOfMonth } = day?.date ?? {};
      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(dayOfMonth) ||
        !isByteCount(day.rx) ||
        !isByteCount(day.tx)
      ) {
        continue;
      }
      const date = toDateKey(Date.UTC(year, month - 1, dayOfMonth));
      const entry = byDate.get(date) ?? { date, rx: 0, tx: 0 };
      entry.rx += day.rx;
      entry.tx += day.tx;
      byDate.set(date, entry);
    }
  }
  if (byDate.size === 0 && updatedAt === null) return null;
  return {
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    updatedAt,
  };
}

// 周期按 UTC 日期计算；vnstat 按宿主机时区划日，非 UTC 时边界日最多偏差一天
export function resolveTrafficCycle(
  now: number,
  resetDay: number,
): { start: number; end: number } {
  const today = new Date(now);
  let start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), resetDay);
  if (start > now) {
    start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, resetDay);
  }
  const startDate = new Date(start);
  const end = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth() + 1,
    resetDay,
  );
  return { start, end };
}

export function computeHostTrafficStatus({
  snapshot,
  settings,
  now,
}: {
  snapshot: TrafficSnapshot | null;
  settings: TrafficSettings;
  now: number;
}): HostTrafficStatus {
  const { start, end } = resolveTrafficCycle(now, settings.ResetDay);
  const cycleStart = toDateKey(start);
  const cycleEnd = toDateKey(end);
  const allDays = snapshot?.days ?? [];
  const days = allDays.filter(
    (day) => day.date >= cycleStart && day.date < cycleEnd,
  );
  const rxBytes = days.reduce((sum, day) => sum + day.rx, 0);
  const txBytes = days.reduce((sum, day) => sum + day.tx, 0);
  const usedBytes = rxBytes + txBytes;
  // vnstat 按宿主机本地时区划日，与 UTC 最多差一天；更早的最后一条说明当天还没有数据
  const latest = allDays.at(-1);
  const today =
    latest && latest.date >= toDateKey(now - DAY_MS) ? latest : undefined;
  const quotaBytes = settings.QuotaGB * TRAFFIC_GB;

  // 速率按实际有数据的时段计算：起点取首条记录（如刚装好 vnstat），终点取统计更新时间，停更后的时间不算作零流量
  const dataStart = days.length
    ? Math.max(start, Date.parse(`${days[0].date}T00:00:00Z`))
    : start;
  const dataEnd = snapshot ? Math.min(now, snapshot.updatedAt) : now;
  const measuredMs = dataEnd - dataStart;
  const projectedBytes =
    snapshot && measuredMs >= TRAFFIC_MIN_PROJECTION_MS
      ? Math.round(usedBytes + (usedBytes / measuredMs) * (end - dataEnd))
      : null;

  const overPauseLine =
    quotaBytes > 0 && usedBytes >= quotaBytes * TRAFFIC_PAUSE_RATIO;
  const relay: TrafficRelayState = !overPauseLine
    ? 'active'
    : settings.RelayResumedCycle === cycleStart
      ? 'resumed'
      : 'paused';

  return {
    available: snapshot !== null,
    updatedAt: snapshot?.updatedAt ?? null,
    stale: snapshot !== null && now - snapshot.updatedAt > TRAFFIC_STALE_MS,
    cycleStart,
    cycleEnd,
    rxBytes,
    txBytes,
    usedBytes,
    todayBytes: today ? today.rx + today.tx : 0,
    quotaBytes,
    usedRatio: quotaBytes > 0 ? usedBytes / quotaBytes : null,
    projectedBytes,
    relay,
  };
}

export function formatTrafficBytes(bytes: number): string {
  if (bytes >= 1000 * TRAFFIC_GB) {
    return `${(bytes / (1000 * TRAFFIC_GB)).toFixed(2)} TB`;
  }
  if (bytes >= TRAFFIC_GB) return `${(bytes / TRAFFIC_GB).toFixed(1)} GB`;
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}
