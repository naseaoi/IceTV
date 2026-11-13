const HOUR_MS = 3_600_000;

export const WATCH_LEVELS = [
  { level: 1, name: '检票', minMs: 0 },
  { level: 2, name: '散座', minMs: 2 * HOUR_MS },
  { level: 3, name: '中排', minMs: 20 * HOUR_MS },
  { level: 4, name: '黄金座', minMs: 80 * HOUR_MS },
  { level: 5, name: '包厢', minMs: 250 * HOUR_MS },
  { level: 6, name: '放映室', minMs: 800 * HOUR_MS },
] as const;

export type WatchLevel = (typeof WATCH_LEVELS)[number]['level'];

export const MAX_WATCH_LEVEL = WATCH_LEVELS.length as WatchLevel;

// 同一账号的所有会话在一个 15 分钟时间桶内合计最多计入一个桶长，多开标签页不重复累计
export const WATCH_LEVEL_BUCKET_CAP_MS = 15 * 60_000;

export function watchLevelForMs(countedMs: number): WatchLevel {
  let level: WatchLevel = 1;
  for (const item of WATCH_LEVELS) {
    if (countedMs >= item.minMs) level = item.level;
  }
  return level;
}

export function watchLevelName(level: WatchLevel): string {
  return WATCH_LEVELS[level - 1].name;
}

export function isWatchLevel(value: unknown): value is WatchLevel {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_WATCH_LEVEL
  );
}

// 播放上报跨过门槛后派发，AuthProvider 据此刷新会话里的本人等级
export const WATCH_LEVEL_UP_EVENT = 'watch-level-up';
