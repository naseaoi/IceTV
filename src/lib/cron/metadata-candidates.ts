import { hasPlayRecordUpdate } from '@/lib/play-records';
import type { Favorite, PlayRecord } from '@/lib/types';

export interface MetadataCandidate<T> {
  user: string;
  key: string;
  item: T;
  /** 数值越小越先刷新 */
  priority: number;
  checkedAt: number;
}

export function shouldRefreshMetadata(
  checkedAt: number | undefined,
  now: number,
  ttlMs: number,
): boolean {
  return (
    typeof checkedAt !== 'number' ||
    !Number.isFinite(checkedAt) ||
    checkedAt > now ||
    now - checkedAt >= ttlMs
  );
}

// 未看完且开启追更的记录优先，其次是已看完的，关闭追更的最后
function getPlayRecordPriority(record: PlayRecord): number {
  if (record.tracking_enabled === false) return 2;
  return hasPlayRecordUpdate(record) || isUnfinished(record) ? 0 : 1;
}

function isUnfinished(record: PlayRecord): boolean {
  const total = record.group_total || record.total_episodes;
  const current = record.group_total ? record.group_index : record.index;
  return Number.isFinite(total) && Number.isFinite(current)
    ? Number(current) < Number(total)
    : true;
}

function toCheckedAt(checkedAt: number | undefined): number {
  return typeof checkedAt === 'number' && Number.isFinite(checkedAt)
    ? checkedAt
    : 0;
}

/**
 * 按“优先级 → 最久未检查”排序，保证预算有限时也能轮转覆盖全部条目，
 * 而不是每次都刷同一批。
 */
export function sortMetadataCandidates<T>(
  candidates: Array<MetadataCandidate<T>>,
): Array<MetadataCandidate<T>> {
  return candidates.sort(compareMetadataCandidates);
}

export function compareMetadataCandidates<T>(
  left: MetadataCandidate<T>,
  right: MetadataCandidate<T>,
): number {
  return (
    left.priority - right.priority ||
    left.checkedAt - right.checkedAt ||
    left.key.localeCompare(right.key)
  );
}

export function buildPlayRecordCandidate(
  user: string,
  key: string,
  record: PlayRecord,
  now: number,
  ttlMs: number,
): MetadataCandidate<PlayRecord> | null {
  if (!shouldRefreshMetadata(record.metadata_checked_at, now, ttlMs)) {
    return null;
  }

  return {
    user,
    key,
    item: record,
    priority: getPlayRecordPriority(record),
    checkedAt: toCheckedAt(record.metadata_checked_at),
  };
}

export function buildFavoriteCandidate(
  user: string,
  key: string,
  favorite: Favorite,
  now: number,
  ttlMs: number,
): MetadataCandidate<Favorite> | null {
  if (
    favorite.origin === 'live' ||
    !shouldRefreshMetadata(favorite.metadata_checked_at, now, ttlMs)
  ) {
    return null;
  }

  return {
    user,
    key,
    item: favorite,
    priority: 0,
    checkedAt: toCheckedAt(favorite.metadata_checked_at),
  };
}

export function collectPlayRecordCandidates(
  user: string,
  records: Record<string, PlayRecord>,
  now: number,
  ttlMs: number,
): Array<MetadataCandidate<PlayRecord>> {
  return Object.entries(records).flatMap(([key, record]) => {
    const candidate = buildPlayRecordCandidate(user, key, record, now, ttlMs);
    return candidate ? [candidate] : [];
  });
}

export function collectFavoriteCandidates(
  user: string,
  favorites: Record<string, Favorite>,
  now: number,
  ttlMs: number,
): Array<MetadataCandidate<Favorite>> {
  return Object.entries(favorites).flatMap(([key, favorite]) => {
    const candidate = buildFavoriteCandidate(user, key, favorite, now, ttlMs);
    return candidate ? [candidate] : [];
  });
}
