import type { EpisodeGroup } from '@/lib/types';

export interface EpisodeGroupPosition {
  groupIndex: number;
  episodeOffset: number;
  groupCount: number;
}

export interface PlayRecordEpisodeIdentity {
  index: number;
  group_index?: number;
  group_total?: number;
  group_label?: string;
}

interface LocatedEpisodeGroup {
  groupIndex: number;
  start: number;
  count: number;
  label: string;
}

function sumGroupCounts(groups: EpisodeGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

export function normalizeGroupLabel(label: string | undefined): string {
  return (label || '').replace(/\s+/g, '').trim();
}

// 分组可换算的前提：至少两组且组集数之和等于实际集数
export function hasUsableEpisodeGroups(
  groups: EpisodeGroup[] | undefined,
  totalEpisodes: number,
): groups is EpisodeGroup[] {
  return (
    !!groups && groups.length >= 2 && sumGroupCounts(groups) === totalEpisodes
  );
}

export function clampEpisodeIndex(
  episodeIndex: number,
  episodeCount: number,
): number {
  const safeIndex = Math.max(0, Math.floor(episodeIndex));
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) {
    return safeIndex;
  }

  return Math.min(safeIndex, episodeCount - 1);
}

/**
 * 把拼接后的全局集索引换算成所在分组内的位置。
 * 分组信息无效（缺失、单组、总数对不上、索引越界）时返回 null。
 */
export function resolveEpisodeGroupPosition(
  groups: EpisodeGroup[] | undefined,
  episodeIndex: number,
  totalEpisodes: number,
): EpisodeGroupPosition | null {
  if (!hasUsableEpisodeGroups(groups, totalEpisodes)) {
    return null;
  }

  if (
    !Number.isInteger(episodeIndex) ||
    episodeIndex < 0 ||
    episodeIndex >= totalEpisodes
  ) {
    return null;
  }

  let start = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const count = groups[groupIndex].count;
    if (episodeIndex < start + count) {
      return {
        groupIndex,
        episodeOffset: episodeIndex - start,
        groupCount: count,
      };
    }
    start += count;
  }

  return null;
}

function locateEpisodeGroups(groups: EpisodeGroup[]): LocatedEpisodeGroup[] {
  let start = 0;
  return groups.map((group, groupIndex) => {
    const located = {
      groupIndex,
      start,
      count: group.count,
      label: normalizeGroupLabel(group.label),
    };
    start += group.count;
    return located;
  });
}

function findGroupByLabel(
  located: LocatedEpisodeGroup[],
  label: string | undefined,
): LocatedEpisodeGroup | null {
  const normalized = normalizeGroupLabel(label);
  if (!normalized) {
    return null;
  }

  const matched = located.filter((group) => group.label === normalized);
  return matched.length === 1 ? matched[0] : null;
}

// 旧记录没有 group_label：仅当绝对索引仍落在与记录组内位置完全一致的分组上，
// 才认为分组结构未变、可安全推断出所属分组
function inferGroupWithoutLabel(
  located: LocatedEpisodeGroup[],
  record: PlayRecordEpisodeIdentity,
): LocatedEpisodeGroup | null {
  if (!record.group_index || !record.group_total) {
    return null;
  }

  const absoluteIndex = Math.floor(record.index) - 1;
  const group = located.find(
    (candidate) =>
      absoluteIndex >= candidate.start &&
      absoluteIndex < candidate.start + candidate.count,
  );

  if (!group) {
    return null;
  }

  return group.count === record.group_total &&
    absoluteIndex - group.start === record.group_index - 1
    ? group
    : null;
}

/** 继续观看卡片透传给播放意图的分组身份 */
export interface ResumeGroupIdentity {
  label?: string;
  index?: number;
  total?: number;
}

export interface ResolvedPlayRecordEpisode {
  /** 换算后的全局 0-based 集索引 */
  episodeIndex: number;
  groupLabel?: string;
  groupIndex?: number;
  groupTotal?: number;
  /** 分组身份是否已确认，可用于回写修正记录 */
  trusted: boolean;
}

/**
 * 依据分组标签把播放记录换算成当前详情下的全局集索引。
 * 上游给靠前的分组新增剧集后，记录里的绝对索引会整体错位，必须按分组重新对齐。
 */
export function resolvePlayRecordEpisode(
  record: PlayRecordEpisodeIdentity,
  groups: EpisodeGroup[] | undefined,
  episodeCount: number,
): ResolvedPlayRecordEpisode {
  const fallbackIndex = clampEpisodeIndex(
    Math.floor(record.index) - 1,
    episodeCount,
  );

  if (!hasUsableEpisodeGroups(groups, episodeCount)) {
    return { episodeIndex: fallbackIndex, trusted: false };
  }

  const located = locateEpisodeGroups(groups);
  const group =
    findGroupByLabel(located, record.group_label) ||
    inferGroupWithoutLabel(located, record);

  if (!group) {
    const position = resolveEpisodeGroupPosition(
      groups,
      fallbackIndex,
      episodeCount,
    );
    return position
      ? {
          episodeIndex: fallbackIndex,
          groupLabel: located[position.groupIndex]?.label,
          groupIndex: position.episodeOffset + 1,
          groupTotal: position.groupCount,
          trusted: false,
        }
      : { episodeIndex: fallbackIndex, trusted: false };
  }

  const offset = record.group_index
    ? Math.min(Math.max(0, record.group_index - 1), group.count - 1)
    : Math.min(Math.max(0, fallbackIndex - group.start), group.count - 1);

  return {
    episodeIndex: clampEpisodeIndex(group.start + offset, episodeCount),
    groupLabel: group.label,
    groupIndex: offset + 1,
    groupTotal: group.count,
    trusted: true,
  };
}
