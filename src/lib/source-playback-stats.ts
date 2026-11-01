export const SOURCE_PLAYBACK_STATS_STORAGE_KEY = 'sourcePlaybackStats';

const STATS_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_SOURCES = 40;
const STARTUP_EWMA_ALPHA = 0.3;
const MAX_STARTUP_MS = 120_000;
const MAX_ATTEMPT_WEIGHT = 20;
const MAX_MANUAL_SELECTIONS = 20;
const IDLE_DECAY_PERIOD_MS = 14 * DAY_MS;
const TRUSTED_MIN_SUCCESSES = 3;
const TRUSTED_MIN_SUCCESS_RATE = 0.8;
const TRUSTED_MAX_IDLE_MS = 14 * DAY_MS;
const UNRELIABLE_MIN_ATTEMPTS = 2;
const UNRELIABLE_MAX_SUCCESS_RATE = 0.5;
const MAX_SOURCE_KEY_LENGTH = 64;

export type SourcePlaybackStat = {
  // 起播耗时的指数加权平均（毫秒），没有有效样本时为 null
  startupMs: number | null;
  successes: number;
  failures: number;
  manualSelections: number;
  lastUsedAt: number;
};

type StoredSourcePlaybackStats = {
  v: typeof STATS_VERSION;
  entries: Array<[string, SourcePlaybackStat]>;
};

function isValidSourceKey(sourceKey: unknown): sourceKey is string {
  return (
    typeof sourceKey === 'string' &&
    sourceKey.length > 0 &&
    sourceKey.length <= MAX_SOURCE_KEY_LENGTH
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function roundCount(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseStat(value: unknown): SourcePlaybackStat | null {
  if (!value || typeof value !== 'object') return null;
  const stat = value as Record<string, unknown>;
  const startupMs = stat.startupMs;
  if (
    !(startupMs === null || isNonNegativeNumber(startupMs)) ||
    !isNonNegativeNumber(stat.successes) ||
    !isNonNegativeNumber(stat.failures) ||
    !isNonNegativeNumber(stat.manualSelections) ||
    !isNonNegativeNumber(stat.lastUsedAt)
  ) {
    return null;
  }
  return {
    startupMs: startupMs === null ? null : Math.min(startupMs, MAX_STARTUP_MS),
    successes: stat.successes,
    failures: stat.failures,
    manualSelections: stat.manualSelections,
    lastUsedAt: stat.lastUsedAt,
  };
}

export function readSourcePlaybackStats(): Map<string, SourcePlaybackStat> {
  const stats = new Map<string, SourcePlaybackStat>();
  if (typeof window === 'undefined') return stats;

  try {
    const raw = window.localStorage.getItem(SOURCE_PLAYBACK_STATS_STORAGE_KEY);
    if (!raw) return stats;
    const parsed = JSON.parse(raw) as Partial<StoredSourcePlaybackStats>;
    if (parsed?.v !== STATS_VERSION || !Array.isArray(parsed.entries)) {
      return stats;
    }
    for (const item of parsed.entries) {
      if (!Array.isArray(item) || !isValidSourceKey(item[0])) continue;
      const stat = parseStat(item[1]);
      if (stat) stats.set(item[0], stat);
    }
  } catch {
    return new Map();
  }
  return stats;
}

function writeSourcePlaybackStats(stats: Map<string, SourcePlaybackStat>) {
  if (typeof window === 'undefined') return;
  const entries = Array.from(stats.entries())
    .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
    .slice(0, MAX_TRACKED_SOURCES);
  const payload: StoredSourcePlaybackStats = { v: STATS_VERSION, entries };
  try {
    window.localStorage.setItem(
      SOURCE_PLAYBACK_STATS_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // 存储配额或隐私模式导致写入失败时只放弃统计，不影响播放
  }
}

// 每闲置满一个周期计数减半；持续使用时由计数上限保证近期结果占主导
function decaySourcePlaybackStat(
  stat: SourcePlaybackStat,
  now = Date.now(),
): SourcePlaybackStat {
  const periods = Math.floor((now - stat.lastUsedAt) / IDLE_DECAY_PERIOD_MS);
  if (periods <= 0) return stat;
  const factor = 0.5 ** periods;
  return {
    ...stat,
    successes: roundCount(stat.successes * factor),
    failures: roundCount(stat.failures * factor),
    manualSelections: roundCount(stat.manualSelections * factor),
  };
}

function capAttempts(stat: SourcePlaybackStat): SourcePlaybackStat {
  const attempts = stat.successes + stat.failures;
  if (attempts <= MAX_ATTEMPT_WEIGHT) return stat;
  const scale = MAX_ATTEMPT_WEIGHT / attempts;
  return {
    ...stat,
    successes: roundCount(stat.successes * scale),
    failures: roundCount(stat.failures * scale),
  };
}

function updateSourcePlaybackStat(
  sourceKey: string,
  update: (stat: SourcePlaybackStat) => SourcePlaybackStat,
) {
  if (!isValidSourceKey(sourceKey)) return;
  const now = Date.now();
  const stats = readSourcePlaybackStats();
  const previous = stats.get(sourceKey);
  const base: SourcePlaybackStat = previous
    ? decaySourcePlaybackStat(previous, now)
    : {
        startupMs: null,
        successes: 0,
        failures: 0,
        manualSelections: 0,
        lastUsedAt: now,
      };
  stats.set(sourceKey, { ...update(base), lastUsedAt: now });
  writeSourcePlaybackStats(stats);
}

export function recordSourcePlaybackSuccess(
  sourceKey: string,
  startupMs: number,
) {
  updateSourcePlaybackStat(sourceKey, (stat) => {
    const sample = isNonNegativeNumber(startupMs)
      ? Math.min(startupMs, MAX_STARTUP_MS)
      : null;
    const startup =
      sample === null
        ? stat.startupMs
        : stat.startupMs === null
          ? sample
          : stat.startupMs + STARTUP_EWMA_ALPHA * (sample - stat.startupMs);
    return capAttempts({
      ...stat,
      startupMs: startup === null ? null : Math.round(startup),
      successes: stat.successes + 1,
    });
  });
}

export function recordSourcePlaybackFailure(sourceKey: string) {
  updateSourcePlaybackStat(sourceKey, (stat) =>
    capAttempts({ ...stat, failures: stat.failures + 1 }),
  );
}

export function recordSourceManualSelection(sourceKey: string) {
  updateSourcePlaybackStat(sourceKey, (stat) => ({
    ...stat,
    manualSelections: Math.min(
      MAX_MANUAL_SELECTIONS,
      stat.manualSelections + 1,
    ),
  }));
}

/** 近期稳定起播过的常用源：可跳过前台测速直接起播。 */
export function isTrustedSourcePlaybackStat(
  stat: SourcePlaybackStat | undefined,
  now = Date.now(),
): boolean {
  if (!stat || now - stat.lastUsedAt > TRUSTED_MAX_IDLE_MS) return false;
  const decayed = decaySourcePlaybackStat(stat, now);
  const attempts = decayed.successes + decayed.failures;
  return (
    decayed.successes >= TRUSTED_MIN_SUCCESSES &&
    decayed.successes / attempts >= TRUSTED_MIN_SUCCESS_RATE
  );
}

type PlaybackPreference = {
  tier: number;
  startupMs: number;
  successes: number;
  manualSelections: number;
};

function resolvePlaybackPreference(
  stat: SourcePlaybackStat | undefined,
  now: number,
): PlaybackPreference {
  if (!stat) {
    return {
      tier: 1,
      startupMs: Number.POSITIVE_INFINITY,
      successes: 0,
      manualSelections: 0,
    };
  }
  const decayed = decaySourcePlaybackStat(stat, now);
  const attempts = decayed.successes + decayed.failures;
  const unreliable =
    attempts >= UNRELIABLE_MIN_ATTEMPTS &&
    decayed.successes / attempts < UNRELIABLE_MAX_SUCCESS_RATE;
  return {
    tier: isTrustedSourcePlaybackStat(stat, now) ? 0 : unreliable ? 2 : 1,
    startupMs: decayed.startupMs ?? Number.POSITIVE_INFINITY,
    successes: decayed.successes,
    manualSelections: decayed.manualSelections,
  };
}

function compareAscending(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 按历史播放表现比较两个源：可信常用源在前（起播快者优先），
 * 普通源按手动选择次数，屡次失败的源垫底；同档返回 0 交给调用方保持原顺序。
 */
export function compareSourcePlaybackPreference(
  a: SourcePlaybackStat | undefined,
  b: SourcePlaybackStat | undefined,
  now = Date.now(),
): number {
  const left = resolvePlaybackPreference(a, now);
  const right = resolvePlaybackPreference(b, now);
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.tier === 0) {
    return (
      compareAscending(left.startupMs, right.startupMs) ||
      compareAscending(right.successes, left.successes)
    );
  }
  if (left.tier === 1) {
    return compareAscending(right.manualSelections, left.manualSelections);
  }
  return 0;
}

export function sortSourcesByPlaybackStats<T>(
  items: readonly T[],
  getSourceKey: (item: T) => string,
  stats: ReadonlyMap<string, SourcePlaybackStat>,
  now = Date.now(),
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      stat: stats.get(getSourceKey(item)),
    }))
    .sort(
      (a, b) =>
        compareSourcePlaybackPreference(a.stat, b.stat, now) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}
