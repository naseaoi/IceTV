import { setImmediate } from 'node:timers/promises';

import {
  type MetadataCandidate,
  buildFavoriteCandidate,
  buildPlayRecordCandidate,
  compareMetadataCandidates,
  getMetadataStaleReferenceTime,
} from '@/lib/cron/metadata-candidates';
import { db } from '@/lib/db';
import {
  hasUsableEpisodeGroups,
  resolvePlayRecordEpisode,
} from '@/lib/episode-groups';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import {
  hasPlayRecordGroupChanged,
  isGroupedPlayRecordScale,
} from '@/lib/play-records';
import type {
  Favorite,
  MetadataRefreshCursor,
  MetadataRefreshKind,
  PlayRecord,
  SearchResult,
} from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const DEFAULT_METADATA_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_METADATA_RECORD_MAX_ITEMS = 240;
const DEFAULT_METADATA_FAVORITE_MAX_ITEMS = 40;
const DEFAULT_METADATA_REFRESH_TIME_BUDGET_MS = 5 * 60 * 1000;
const DEFAULT_METADATA_PAGE_SIZE = 100;
const RECORD_TIME_BUDGET_RATIO = 0.7;

export type MetadataRefreshBudget = {
  startedAt: number;
  maxItems: number;
  timeBudgetMs: number;
  processed: number;
};

export type GetDetail = (
  source: string,
  id: string,
  fallbackTitle: string,
  retry?: boolean,
) => Promise<SearchResult | null>;

type RefreshItem =
  | { kind: 'record'; value: PlayRecord }
  | { kind: 'favorite'; value: Favorite };

class TopMetadataCandidates<T> {
  private readonly items: Array<MetadataCandidate<T>> = [];

  constructor(private readonly maxItems: number) {}

  add(candidate: MetadataCandidate<T>): void {
    if (this.maxItems <= 0) return;
    const existing = this.items.findIndex((item) => item.key === candidate.key);
    if (existing >= 0) {
      if (compareMetadataCandidates(this.items[existing], candidate) <= 0)
        return;
      this.items.splice(existing, 1);
    }
    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compareMetadataCandidates(this.items[middle], candidate) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    this.items.splice(low, 0, candidate);
    if (this.items.length > this.maxItems) this.items.pop();
  }

  toArray(): Array<MetadataCandidate<T>> {
    return this.items;
  }
}

function buildCandidate(
  kind: MetadataRefreshKind,
  row: MetadataRefreshCursor & { snapshot: string },
  now: number,
  ttlMs: number,
  includeFresh = false,
): MetadataCandidate<RefreshItem> | null {
  if (!parseStorageKey(row.key)) return null;
  try {
    const value = JSON.parse(row.snapshot);
    if (!value || typeof value !== 'object') return null;
    const eligibilityValue = includeFresh
      ? { ...value, metadata_checked_at: undefined }
      : value;
    if (kind === 'record') {
      const candidate = buildPlayRecordCandidate(
        row.user,
        row.key,
        eligibilityValue,
        now,
        ttlMs,
        row.snapshot,
      );
      return candidate && { ...candidate, item: { kind, value } };
    }
    const candidate = buildFavoriteCandidate(
      row.user,
      row.key,
      eligibilityValue,
      now,
      ttlMs,
      row.snapshot,
    );
    return candidate && { ...candidate, item: { kind, value } };
  } catch (error) {
    console.error(`处理元数据候选失败 (${row.user}:${row.key}):`, error);
    return null;
  }
}

const scanCursors: Partial<Record<MetadataRefreshKind, MetadataRefreshCursor>> =
  {};

async function collectPagedCandidates(
  kind: MetadataRefreshKind,
  maxItems: number,
  pageSize: number,
  now: number,
  ttlMs: number,
  deadline: number,
): Promise<Array<MetadataCandidate<RefreshItem>>> {
  const topCandidates = new TopMetadataCandidates<RefreshItem>(maxItems);
  let cursor = scanCursors[kind];
  const canWrap = cursor !== undefined;
  let wrapped = false;
  let firstRow: MetadataRefreshCursor | undefined;
  while (Date.now() < deadline) {
    const page = await db.getMetadataRefreshPage(kind, pageSize, cursor);
    for (const row of page.items) {
      // 使用数据库返回的首行作回绕边界，避免 JS 字符串序与 MySQL ci 序不同。
      if (wrapped && row.key === firstRow?.key && row.user === firstRow.user) {
        delete scanCursors[kind];
        return topCandidates.toArray();
      }
      if (!wrapped && !firstRow) firstRow = { key: row.key, user: row.user };
      const candidate = buildCandidate(kind, row, now, ttlMs);
      if (candidate) topCandidates.add(candidate);
      scanCursors[kind] = { key: row.key, user: row.user };
    }
    if (!page.nextCursor) {
      delete scanCursors[kind];
      if (!canWrap || wrapped) break;
      wrapped = true;
      cursor = undefined;
    } else {
      cursor = page.nextCursor;
    }
    await setImmediate();
  }
  return topCandidates.toArray();
}

// 详情回源前读取关联快照，回源期间的进度、已读、开关或删除由原始 JSON CAS 保护。
async function loadWorkCandidates(
  key: string,
  pageSize: number,
  budget: MetadataRefreshBudget,
): Promise<Array<MetadataCandidate<RefreshItem>> | null> {
  const candidates: Array<MetadataCandidate<RefreshItem>> = [];
  for (const kind of ['record', 'favorite'] as const) {
    let cursor: MetadataRefreshCursor | undefined;
    do {
      if (!hasTimeBudget(budget)) return null;
      const page = await db.getMetadataRefreshPage(kind, pageSize, cursor, key);
      for (const row of page.items) {
        // 已选作品同步全部关联条目，仍排除目录与直播收藏。
        const candidate = buildCandidate(kind, row, Date.now(), 0, true);
        if (candidate) candidates.push(candidate);
      }
      cursor = page.nextCursor ?? undefined;
      await setImmediate();
    } while (cursor);
  }
  return hasTimeBudget(budget) ? candidates : null;
}

export async function refreshRecordAndFavorites(): Promise<void> {
  try {
    const metadataRefreshTtlMs = readPositiveInteger(
      process.env.CRON_METADATA_REFRESH_TTL_MS,
      DEFAULT_METADATA_REFRESH_TTL_MS,
    );
    const totalTimeBudgetMs = readPositiveInteger(
      process.env.CRON_METADATA_TIME_BUDGET_MS,
      DEFAULT_METADATA_REFRESH_TIME_BUDGET_MS,
    );
    const recordMaxItems = readPositiveInteger(
      process.env.CRON_METADATA_RECORD_MAX_ITEMS ||
        process.env.CRON_METADATA_MAX_ITEMS,
      DEFAULT_METADATA_RECORD_MAX_ITEMS,
    );
    const favoriteMaxItems = readPositiveInteger(
      process.env.CRON_METADATA_FAVORITE_MAX_ITEMS,
      DEFAULT_METADATA_FAVORITE_MAX_ITEMS,
    );
    const metadataPageSize = readPositiveInteger(
      process.env.CRON_METADATA_PAGE_SIZE,
      DEFAULT_METADATA_PAGE_SIZE,
    );
    const startedAt = Date.now();
    const staleReferenceTime = getMetadataStaleReferenceTime(
      startedAt,
      metadataRefreshTtlMs,
      totalTimeBudgetMs,
    );
    const getDetail: GetDetail = (source, id, fallbackTitle) =>
      fetchVideoDetail({
        source,
        id,
        fallbackTitle: fallbackTitle.trim(),
      }).catch((error) => {
        console.error(`获取视频详情失败 (${source}+${id}):`, error);
        return null;
      });

    // 收集至多使用整轮 20% 时间，为刷新保留预算；两类扫描独立保留一半。
    const collectionBudgetMs = Math.max(1, Math.floor(totalTimeBudgetMs * 0.1));
    const recordCandidates = await collectPagedCandidates(
      'record',
      recordMaxItems,
      metadataPageSize,
      staleReferenceTime,
      metadataRefreshTtlMs,
      startedAt + collectionBudgetMs,
    );
    const favoriteCandidates = await collectPagedCandidates(
      'favorite',
      favoriteMaxItems + recordMaxItems,
      metadataPageSize,
      staleReferenceTime,
      metadataRefreshTtlMs,
      Math.min(
        Date.now() + collectionBudgetMs,
        startedAt + collectionBudgetMs * 2,
      ),
    );
    const processedKeys = new Set<string>();
    const target: MetadataTarget<RefreshItem> = {
      label: '作品元数据',
      getTitle: (item) => item.value.title,
      build: (item, detail, checkedAt) =>
        item.kind === 'record'
          ? {
              kind: 'record',
              value: buildRefreshedPlayRecord(item.value, detail, checkedAt),
            }
          : {
              kind: 'favorite',
              value: buildRefreshedFavorite(item.value, detail, checkedAt),
            },
      saveIfUnchanged: (user, source, id, item, snapshot) =>
        item.kind === 'record'
          ? db.savePlayRecordIfUnchanged(user, source, id, item.value, snapshot)
          : db.saveFavoriteIfUnchanged(user, source, id, item.value, snapshot),
      loadRelated: (candidate, budget) =>
        loadWorkCandidates(candidate.key, metadataPageSize, budget),
    };

    // 播放记录与收藏各自独立预算，避免其中一方吃满预算导致另一方长期不刷新
    const recordBudget: MetadataRefreshBudget = {
      startedAt,
      maxItems: recordMaxItems,
      timeBudgetMs: Math.floor(totalTimeBudgetMs * RECORD_TIME_BUDGET_RATIO),
      processed: 0,
    };
    await refreshMetadataCandidates(
      recordCandidates,
      recordBudget,
      getDetail,
      target,
      processedKeys,
    );

    const favoriteBudget: MetadataRefreshBudget = {
      startedAt,
      maxItems: favoriteMaxItems,
      timeBudgetMs: totalTimeBudgetMs,
      processed: 0,
    };
    await refreshMetadataCandidates(
      favoriteCandidates,
      favoriteBudget,
      getDetail,
      target,
      processedKeys,
    );

    console.log(
      `刷新播放记录/收藏任务完成: 播放作品 ${recordBudget.processed}，额外收藏作品 ${favoriteBudget.processed}`,
    );
  } catch (error) {
    console.error('刷新播放记录/收藏任务启动失败', error);
  }
}

export type MetadataTarget<T> = {
  label: string;
  getTitle: (item: T) => string;
  build: (item: T, detail: SearchResult | null, checkedAt: number) => T;
  saveIfUnchanged: (
    user: string,
    source: string,
    id: string,
    next: T,
    snapshot: string,
  ) => Promise<boolean>;
  loadRelated?: (
    candidate: MetadataCandidate<T>,
    budget: MetadataRefreshBudget,
  ) => Promise<Array<MetadataCandidate<T>> | null>;
};

export async function refreshMetadataCandidates<T>(
  candidates: Array<MetadataCandidate<T>>,
  budget: MetadataRefreshBudget,
  getDetail: GetDetail,
  target: MetadataTarget<T>,
  processedKeys = new Set<string>(),
): Promise<void> {
  const save = async (
    candidate: MetadataCandidate<T>,
    source: string,
    id: string,
    detail: SearchResult | null,
    checkedAt: number,
  ) => {
    try {
      const saved = await target.saveIfUnchanged(
        candidate.user,
        source,
        id,
        target.build(candidate.item, detail, checkedAt),
        candidate.snapshot,
      );
      if (!saved) {
        console.warn(`跳过并发变更的${target.label}: ${candidate.key}`);
      }
    } catch (error) {
      console.error(`处理${target.label}失败 (${candidate.key}):`, error);
    }
  };

  const saveRelated = async (
    related: Array<MetadataCandidate<T>>,
    source: string,
    id: string,
    detail: SearchResult | null,
    checkedAt: number,
  ) => {
    // 每条 CAS 独立提交，最多连续写 50 条后让出；不持有跨用户的长事务。
    for (let index = 0; index < related.length; index += 1) {
      await save(related[index], source, id, detail, checkedAt);
      if ((index + 1) % 50 === 0) await setImmediate();
    }
    await setImmediate();
  };
  const grouped = new Map<string, Array<MetadataCandidate<T>>>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.key) ?? [];
    group.push(candidate);
    grouped.set(candidate.key, group);
  }
  const failed: Array<{
    candidate: MetadataCandidate<T>;
    related: Array<MetadataCandidate<T>>;
    source: string;
    id: string;
    checkedAt: number;
  }> = [];
  for (const group of grouped.values()) {
    const candidate = group[0];
    if (processedKeys.has(candidate.key)) continue;
    if (!canProcessMetadata(budget)) break;
    const parsed = parseStorageKey(candidate.key);
    if (!parsed) continue;
    const loaded = target.loadRelated
      ? await target.loadRelated(candidate, budget)
      : group;
    if (!loaded || !hasTimeBudget(budget)) break;
    // 原始作品键逐字匹配；存储排序规则或关联读取变化也不能跨作品写回。
    const related = loaded.filter((item) => item.key === candidate.key);
    if (!related.length) continue;

    budget.processed += 1;
    processedKeys.add(candidate.key);
    const checkedAt = Date.now();
    const detail = await getDetail(
      parsed.source,
      parsed.id,
      target.getTitle(candidate.item),
    );
    if (detail) {
      await saveRelated(related, parsed.source, parsed.id, detail, checkedAt);
    } else {
      failed.push({ candidate, related, ...parsed, checkedAt });
    }
  }

  // 已开始作品完成全部 CAS 写回，即使详情耗尽时间；预算约束后续回源与候选读取。
  for (const { candidate, related, source, id, checkedAt } of failed) {
    const detail = hasTimeBudget(budget)
      ? await getDetail(source, id, target.getTitle(candidate.item), true)
      : null;
    if (!detail) {
      console.warn(`跳过无法获取详情的${target.label}: ${candidate.key}`);
    }
    await saveRelated(
      related,
      source,
      id,
      detail,
      detail ? Date.now() : checkedAt,
    );
  }
}

export function buildRefreshedFavorite(
  favorite: Favorite,
  detail: SearchResult | null,
  checkedAt: number,
): Favorite {
  const next: Favorite = {
    ...favorite,
    update_baseline_episodes:
      favorite.update_baseline_episodes ?? favorite.total_episodes,
    metadata_checked_at: checkedAt,
    cover: detail?.poster || favorite.cover,
  };
  const total = detail?.episodes?.length ?? 0;
  if (detail && total > 0 && total !== favorite.total_episodes) {
    next.title =
      favorite.catalog_origin?.title || detail.title || favorite.title;
    next.year = favorite.catalog_origin?.year || detail.year || favorite.year;
    next.total_episodes = total;
    if (total > favorite.total_episodes) next.update_detected_at = checkedAt;
  }
  return next;
}

function hasTimeBudget(budget: MetadataRefreshBudget): boolean {
  return Date.now() - budget.startedAt < budget.timeBudgetMs;
}

function canProcessMetadata(budget: MetadataRefreshBudget): boolean {
  return budget.processed < budget.maxItems && hasTimeBudget(budget);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 刷新播放记录：写入最新集数，并按分组标签把 index/group_* 重新对齐到当前详情。
 * 上游给靠前分组新增剧集后，记录里的绝对索引会整体错位，必须一并修正。
 */
export function buildRefreshedPlayRecord(
  record: PlayRecord,
  detail: SearchResult | null,
  checkedAt: number,
): PlayRecord {
  const baseRecord: PlayRecord = {
    ...record,
    cover: detail?.poster || record.cover,
    series_status: detail?.series_status ?? record.series_status,
    metadata_checked_at: checkedAt,
    update_baseline_episodes:
      record.update_baseline_episodes ?? record.total_episodes,
    update_baseline_group_total:
      record.update_baseline_group_total ?? record.group_total,
  };

  const episodeCount = detail?.episodes?.length || 0;
  if (!detail || episodeCount <= 0) {
    return baseRecord;
  }

  const aligned = resolvePlayRecordEpisode(
    record,
    detail.episode_groups,
    episodeCount,
  );
  const keepsGrouping =
    hasUsableEpisodeGroups(detail.episode_groups, episodeCount) &&
    !!aligned.groupIndex &&
    !!aligned.groupTotal;

  const nextGroupFields = keepsGrouping
    ? {
        group_index: aligned.groupIndex,
        group_total: aligned.groupTotal,
        ...(aligned.groupLabel ? { group_label: aligned.groupLabel } : {}),
      }
    : // 上游撤掉分组时清空残留组字段
      {
        group_index: undefined,
        group_total: undefined,
        group_label: undefined,
        update_baseline_group_total: undefined,
        update_message_read_group_total: undefined,
      };

  const groupChanged =
    keepsGrouping && hasPlayRecordGroupChanged(record, nextGroupFields);
  const previousTotal = isGroupedPlayRecordScale(record)
    ? (record.group_total as number)
    : record.total_episodes;
  const nextTotal = keepsGrouping
    ? (aligned.groupTotal as number)
    : episodeCount;
  const hasNewEpisodes = !groupChanged && nextTotal > previousTotal;

  const nextRecord: PlayRecord = {
    ...baseRecord,
    title: detail.title || record.title,
    cover: detail.poster || record.cover,
    year: detail.year || record.year,
    total_episodes: episodeCount,
    index: aligned.episodeIndex + 1,
    ...nextGroupFields,
    ...(groupChanged ? { update_baseline_group_total: nextTotal } : {}),
    ...(groupChanged || keepsGrouping !== isGroupedPlayRecordScale(record)
      ? {
          update_message_read_episodes: undefined,
          update_message_read_group_total: undefined,
        }
      : {}),
    ...(hasNewEpisodes ? { update_detected_at: checkedAt } : {}),
  };

  if (hasNewEpisodes) {
    console.log(
      `更新播放记录: ${record.title} (${previousTotal} -> ${nextTotal})`,
    );
  }

  if (nextRecord.index !== record.index) {
    console.log(
      `修正播放记录集索引: ${record.title} (${record.index} -> ${nextRecord.index})`,
    );
  }

  return nextRecord;
}
