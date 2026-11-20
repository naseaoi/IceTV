import type { EpisodeProgressEntry, PlayRecord } from '@/lib/types';

export type { EpisodeProgressEntry } from '@/lib/types';

export const MAX_EPISODE_PROGRESS_ENTRIES = 50;
export const MAX_EPISODE_PROGRESS_KEY_LENGTH = 160;

// 集身份：可选分组前缀 `g:<组标签>|`，后接 `n:<集号>`（跨源通用）或 `i:<源>:<序号>`（只认同源）。
// 旧版序号身份带 `/<集数>` 后缀，连载每更新一集就整体失配；仍接受这种输入，入表时去掉后缀
const EPISODE_PROGRESS_KEY_PATTERN =
  /^(?:g:[^|\u0000-\u001f]{1,64}\|)?(?:n:\d{1,6}(?:\.\d{1,3})?|i:[^:\u0000-\u001f]{1,64}:\d{1,6}(?:\/\d{1,6})?)$/;
const INDEX_KEY_SOURCE_PATTERN = /(?:^|\|)i:([^:]+):\d+(?:\/\d+)?$/;
const LEGACY_INDEX_KEY_PATTERN = /((?:^|\|)i:[^:]+:\d+)\/\d+$/;

export function normalizeEpisodeProgressKey(key: string): string {
  return key.replace(LEGACY_INDEX_KEY_PATTERN, '$1');
}

export function isEpisodeProgressKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_EPISODE_PROGRESS_KEY_LENGTH &&
    EPISODE_PROGRESS_KEY_PATTERN.test(value)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isEpisodeProgressEntry(value: unknown): value is EpisodeProgressEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    isEpisodeProgressKey(entry.k) &&
    isNonNegativeSafeInteger(entry.t) &&
    isNonNegativeSafeInteger(entry.d) &&
    isNonNegativeSafeInteger(entry.at)
  );
}

// 索引身份只在原来的源里成立，换到别的源后无从映射，合并时直接丢弃
function belongsToSource(key: string, source: string | undefined): boolean {
  if (source === undefined) return true;
  const match = key.match(INDEX_KEY_SOURCE_PATTERN);
  return !match || match[1] === source;
}

/**
 * 按集身份合并多份每集进度：同一集取保存时间较新的一条，按保存时间倒序保留上限条数。
 * 输入来自存储或客户端，逐条校验，畸形条目丢弃。
 */
export function mergeEpisodeProgress(
  lists: ReadonlyArray<unknown>,
  options: { source?: string } = {},
): EpisodeProgressEntry[] {
  const byKey = new Map<string, EpisodeProgressEntry>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isEpisodeProgressEntry(item)) continue;
      if (!belongsToSource(item.k, options.source)) continue;
      const k = normalizeEpisodeProgressKey(item.k);
      const existing = byKey.get(k);
      if (!existing || item.at > existing.at) {
        byKey.set(k, { k, t: item.t, d: item.d, at: item.at });
      }
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_EPISODE_PROGRESS_ENTRIES);
}

export function createEpisodeProgressEntry(
  key: string,
  record: Pick<PlayRecord, 'play_time' | 'total_time' | 'save_time'>,
): EpisodeProgressEntry | null {
  const entry = {
    k: normalizeEpisodeProgressKey(key),
    t: Math.floor(record.play_time),
    d: Math.floor(record.total_time),
    at: Math.floor(record.save_time),
  };
  return isEpisodeProgressEntry(entry) ? entry : null;
}

/**
 * 记录的每集进度写入：携带集身份时把本集快照并入已有表，否则原样保留已有表。
 * 不采信写入方自带的整张表，旧客户端或过期缓存因此无法覆盖。
 */
export function applyEpisodeProgressWrite(
  existing: unknown,
  record: Pick<
    PlayRecord,
    'episode_key' | 'play_time' | 'total_time' | 'save_time'
  >,
  options: { source?: string } = {},
): EpisodeProgressEntry[] | undefined {
  const entry = isEpisodeProgressKey(record.episode_key)
    ? createEpisodeProgressEntry(record.episode_key, record)
    : null;
  const merged = mergeEpisodeProgress(
    entry ? [[entry], existing] : [existing],
    options,
  );
  return merged.length ? merged : undefined;
}
