import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import { hasPlayRecordUpdate, isTrackingEnabled } from '@/lib/play-records';
import type {
  Favorite,
  MetadataRefreshCursor,
  MetadataRefreshKind,
  MetadataRefreshPage,
  PlayRecord,
} from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

// 全局扫描与单作品关联读取共用 (作品键, 用户名) 索引和游标；不按用户枚举。
export function metadataRefreshPageQuery(
  kind: MetadataRefreshKind,
  limit: number,
  cursor?: MetadataRefreshCursor,
  workKey?: string,
  dialect: 'sqlite' | 'mysql' = 'sqlite',
): { sql: string; params: Array<string | number>; limit: number } {
  const table = kind === 'record' ? 'play_records' : 'favorites';
  const key = kind === 'record' ? 'record_key' : 'favorite_key';
  const json = kind === 'record' ? 'record_json' : 'favorite_json';
  const pageLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (workKey !== undefined) {
    conditions.push(`${key} = ?`);
    params.push(workKey);
    if (dialect === 'mysql') {
      // 保留原列等值条件用于索引定位，再逐字节区分大小写与尾部空格。
      conditions.push(`BINARY ${key} = BINARY ?`);
      params.push(workKey);
    }
    if (cursor) {
      conditions.push('username > ?');
      params.push(cursor.user);
    }
  } else if (cursor) {
    // 显式首列下界让两后端均从游标附近开始索引范围扫描。
    conditions.push(
      `${key} >= ? AND (${key} > ? OR (${key} = ? AND username > ?))`,
    );
    params.push(cursor.key, cursor.key, cursor.key, cursor.user);
  }
  params.push(pageLimit + 1);
  return {
    sql: `SELECT username AS user, ${key} AS work_key, ${json} AS snapshot
      FROM ${table}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY ${key} ASC, username ASC LIMIT ?`,
    params,
    limit: pageLimit,
  };
}

export function buildMetadataRefreshPage(
  rows: Array<{ user: string; work_key: string; snapshot: string }>,
  limit: number,
): MetadataRefreshPage {
  const items = rows.slice(0, limit).map((row) => ({
    user: row.user,
    key: row.work_key,
    snapshot: row.snapshot,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last ? { key: last.key, user: last.user } : null,
  };
}

export const ENDED_SERIES_METADATA_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MetadataCandidate<T> {
  user: string;
  key: string;
  item: T;
  snapshot: string;
  /** 数值越小越先刷新 */
  priority: number;
  checkedAt: number;
}

function serializeSnapshot(value: unknown): string {
  const snapshot = JSON.stringify(value);
  if (typeof snapshot !== 'string') {
    throw new Error('元数据快照序列化失败');
  }
  return snapshot;
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

/**
 * 判断陈旧所用的参考时刻。条目的检查时间写在处理时，晚于本轮开始时间；
 * 若直接用开始时间比较，调度周期等于检查间隔时，上一轮处理过的条目在下一轮
 * 差几秒不到期，实际要隔两个周期才刷新。参考时刻后移一个单轮时间预算，
 * 上一轮预算内处理的条目在下一轮都会到期；不超过检查间隔的一半，避免短间隔时每轮全刷。
 */
export function getMetadataStaleReferenceTime(
  startedAt: number,
  ttlMs: number,
  timeBudgetMs: number,
): number {
  return startedAt + Math.min(timeBudgetMs, Math.floor(ttlMs / 2));
}

// 开启追更的连载（含已追平、等新集的）优先；完结作品看完后降级，关闭追更的最后
function getPlayRecordPriority(record: PlayRecord): number {
  if (!isTrackingEnabled(record)) return 2;
  if (record.series_status !== 'ended') return 0;
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
  snapshot?: string,
): MetadataCandidate<PlayRecord> | null {
  const refreshTtlMs =
    record.tracking_enabled !== true && record.series_status === 'ended'
      ? Math.max(ttlMs, ENDED_SERIES_METADATA_REFRESH_TTL_MS)
      : ttlMs;
  if (!shouldRefreshMetadata(record.metadata_checked_at, now, refreshTtlMs)) {
    return null;
  }

  return {
    user,
    key,
    item: record,
    snapshot: snapshot ?? serializeSnapshot(record),
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
  snapshot?: string,
): MetadataCandidate<Favorite> | null {
  if (
    isCatalogFavoriteSource(parseStorageKey(key)?.source ?? '') ||
    favorite.origin === 'live' ||
    !shouldRefreshMetadata(favorite.metadata_checked_at, now, ttlMs)
  ) {
    return null;
  }

  return {
    user,
    key,
    item: favorite,
    snapshot: snapshot ?? serializeSnapshot(favorite),
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
