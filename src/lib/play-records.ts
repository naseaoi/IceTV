import {
  type ResumeGroupIdentity,
  normalizeGroupLabel,
} from '@/lib/episode-groups';
import type { PlayRecord, PlayRecordPage } from '@/lib/types';

export const DEFAULT_RECENT_PLAY_RECORD_LIMIT = 10;
export const MAX_RECENT_PLAY_RECORD_LIMIT = 100;

export type { PlayRecordPage } from '@/lib/types';

export interface PlayRecordCursor {
  time: number;
  key: string;
}

export function normalizePlayRecordLimit(
  value: unknown,
  fallback = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  const normalizedFallback = Math.min(
    MAX_RECENT_PLAY_RECORD_LIMIT,
    Math.max(1, Math.floor(fallback)),
  );

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return normalizedFallback;
  }

  return Math.min(MAX_RECENT_PLAY_RECORD_LIMIT, Math.floor(parsed));
}

export function selectRecentPlayRecords(
  records: Record<string, PlayRecord>,
  limit = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
): Record<string, PlayRecord> {
  const normalizedLimit = normalizePlayRecordLimit(limit);

  return Object.fromEntries(
    Object.entries(records)
      .sort(([, left], [, right]) => right.save_time - left.save_time)
      .slice(0, normalizedLimit),
  );
}

function sortPlayRecordEntries(
  records: Record<string, PlayRecord>,
): Array<[string, PlayRecord]> {
  return Object.entries(records).sort(([leftKey, left], [rightKey, right]) => {
    const timeDifference = right.save_time - left.save_time;
    return timeDifference || rightKey.localeCompare(leftKey);
  });
}

export function selectPlayRecordPage(
  records: Record<string, PlayRecord>,
  limit = DEFAULT_RECENT_PLAY_RECORD_LIMIT,
  cursor?: string | null,
): PlayRecordPage {
  const normalizedLimit = normalizePlayRecordLimit(limit);
  const entries = sortPlayRecordEntries(records);
  let startIndex = 0;

  if (cursor) {
    const separatorIndex = cursor.indexOf('|');
    const cursorTime = Number.parseInt(cursor.slice(0, separatorIndex), 10);
    const cursorKey =
      separatorIndex >= 0 ? cursor.slice(separatorIndex + 1) : '';
    const cursorIndex = entries.findIndex(
      ([key, record]) =>
        key === cursorKey &&
        Number.isFinite(cursorTime) &&
        record.save_time === cursorTime,
    );
    if (Number.isFinite(cursorTime) && cursorKey) {
      startIndex =
        cursorIndex >= 0
          ? cursorIndex + 1
          : entries.findIndex(
              ([key, record]) =>
                record.save_time < cursorTime ||
                (record.save_time === cursorTime &&
                  key.localeCompare(cursorKey) < 0),
            );
      if (startIndex < 0) startIndex = entries.length;
    }
  }

  const pageEntries = entries.slice(startIndex, startIndex + normalizedLimit);
  const lastEntry = pageEntries.at(-1);
  const nextCursor =
    lastEntry && startIndex + pageEntries.length < entries.length
      ? `${lastEntry[1].save_time}|${lastEntry[0]}`
      : null;

  return {
    items: Object.fromEntries(pageEntries),
    total: entries.length,
    nextCursor,
  };
}

export function parsePlayRecordCursor(
  cursor?: string | null,
): PlayRecordCursor | null {
  if (!cursor) return null;

  const separatorIndex = cursor.indexOf('|');
  const time = Number.parseInt(cursor.slice(0, separatorIndex), 10);
  const key = separatorIndex >= 0 ? cursor.slice(separatorIndex + 1) : '';
  return Number.isFinite(time) && key ? { time, key } : null;
}

export function getPlayRecordResumeGroup(
  record: PlayRecord,
): ResumeGroupIdentity | undefined {
  if (!record.group_index || !record.group_total) return undefined;

  return {
    label: record.group_label,
    index: record.group_index,
    total: record.group_total,
  };
}

// group_index 与 group_total 同时可用才算分组刻度
export function isGroupedPlayRecordScale(record: {
  group_index?: number;
  group_total?: number;
}): boolean {
  return !!record.group_index && !!record.group_total;
}

export function getPlayRecordEpisodeDisplay(record: PlayRecord): {
  currentEpisode: number;
  totalEpisodes: number;
} {
  if (isGroupedPlayRecordScale(record)) {
    return {
      currentEpisode: record.group_index as number,
      totalEpisodes: record.group_total as number,
    };
  }

  return {
    currentEpisode: record.index,
    totalEpisodes: record.total_episodes,
  };
}

export function getPlayRecordUpdateBaseline(record: PlayRecord): number {
  const { totalEpisodes } = getPlayRecordEpisodeDisplay(record);
  const baselineValue = isGroupedPlayRecordScale(record)
    ? record.update_baseline_group_total
    : record.update_baseline_episodes;
  return Number.isFinite(baselineValue) ? Number(baselineValue) : totalEpisodes;
}

// 两侧标签都存在且不同才算换组
export function hasPlayRecordGroupChanged(
  previous: Pick<PlayRecord, 'group_index' | 'group_total' | 'group_label'>,
  next: Pick<PlayRecord, 'group_index' | 'group_total' | 'group_label'>,
): boolean {
  if (!isGroupedPlayRecordScale(previous) || !isGroupedPlayRecordScale(next)) {
    return false;
  }

  const previousLabel = normalizeGroupLabel(previous.group_label);
  const nextLabel = normalizeGroupLabel(next.group_label);
  return !!previousLabel && !!nextLabel && previousLabel !== nextLabel;
}

export function hasPlayRecordUpdate(record: PlayRecord): boolean {
  if (record.tracking_enabled === false) return false;

  const { currentEpisode, totalEpisodes } = getPlayRecordEpisodeDisplay(record);
  const baseline = getPlayRecordUpdateBaseline(record);
  return totalEpisodes > baseline && currentEpisode < totalEpisodes;
}

export function markPlayRecordUpdateRead(
  record: PlayRecord,
  readThroughEpisodes?: number,
): PlayRecord {
  const { totalEpisodes } = getPlayRecordEpisodeDisplay(record);
  const baseline = getPlayRecordUpdateBaseline(record);
  const requestedEpisodes = Number.isFinite(readThroughEpisodes)
    ? Number(readThroughEpisodes)
    : totalEpisodes;
  const nextBaseline = Math.max(
    baseline,
    Math.min(totalEpisodes, requestedEpisodes),
  );
  return {
    ...record,
    ...(isGroupedPlayRecordScale(record)
      ? { update_baseline_group_total: nextBaseline }
      : { update_baseline_episodes: nextBaseline }),
  };
}

export function mergePlayRecordUpdateBaseline(
  previous: PlayRecord | null | undefined,
  next: PlayRecord,
): PlayRecord {
  const { currentEpisode, totalEpisodes } = getPlayRecordEpisodeDisplay(next);
  const isGrouped = isGroupedPlayRecordScale(next);
  // 换组时以新组集数重建基线
  const groupChanged = previous
    ? hasPlayRecordGroupChanged(previous, next)
    : false;
  const previousBaselineValue = isGrouped
    ? previous?.update_baseline_group_total
    : previous?.update_baseline_episodes;
  const previousTotal = isGrouped
    ? previous?.group_total
    : previous?.total_episodes;
  const previousBaseline = Number.isFinite(previousBaselineValue)
    ? Number(previousBaselineValue)
    : Number.isFinite(previousTotal)
      ? Number(previousTotal)
      : totalEpisodes;
  const baseline =
    groupChanged || currentEpisode >= totalEpisodes
      ? totalEpisodes
      : Math.min(totalEpisodes, previousBaseline);

  return {
    ...next,
    tracking_enabled: next.tracking_enabled ?? previous?.tracking_enabled,
    ...(isGrouped
      ? { update_baseline_group_total: Math.max(0, baseline) }
      : { update_baseline_episodes: Math.max(0, baseline) }),
  };
}
