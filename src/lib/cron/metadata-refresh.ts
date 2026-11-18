import {
  type MetadataCandidate,
  buildFavoriteCandidate,
  buildPlayRecordCandidate,
  compareMetadataCandidates,
  getMetadataStaleReferenceTime,
} from '@/lib/cron/metadata-candidates';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
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
  MetadataRecordPage,
  PlayRecord,
  SearchResult,
} from '@/lib/types';
import { normalizeUsername } from '@/lib/username';
import { parseStorageKey } from '@/lib/utils';

const DEFAULT_METADATA_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_METADATA_RECORD_MAX_ITEMS = 80;
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

type CandidateCollection<T> = {
  candidates: Array<MetadataCandidate<T>>;
  total: number;
};

class TopMetadataCandidates<T> {
  private readonly items: Array<MetadataCandidate<T>> = [];

  constructor(private readonly maxItems: number) {}

  add(candidate: MetadataCandidate<T>): void {
    if (this.maxItems <= 0) return;

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
    if (this.items.length > this.maxItems) {
      this.items.pop();
    }
  }

  toArray(): Array<MetadataCandidate<T>> {
    return this.items;
  }
}

async function collectPagedCandidates<T>(
  users: string[],
  maxItems: number,
  fetchPage: (
    user: string,
    cursorKey?: string,
  ) => Promise<MetadataRecordPage<T>>,
  buildCandidate: (
    user: string,
    key: string,
    item: T,
    snapshot: string,
  ) => MetadataCandidate<T> | null,
  errorLabel: string,
): Promise<CandidateCollection<T>> {
  const topCandidates = new TopMetadataCandidates<T>(maxItems);
  let total = 0;

  for (const user of users) {
    let cursorKey: string | undefined;
    for (;;) {
      let page: MetadataRecordPage<T>;
      try {
        page = await fetchPage(user, cursorKey);
      } catch (error) {
        console.error(`${errorLabel} (${user}):`, error);
        break;
      }

      for (const { key, item, snapshot } of page.items) {
        let candidate: MetadataCandidate<T> | null;
        try {
          candidate = buildCandidate(user, key, item, snapshot);
        } catch (error) {
          console.error(`处理元数据候选失败 (${user}:${key}):`, error);
          continue;
        }
        if (!candidate) continue;
        total += 1;
        topCandidates.add(candidate);
      }

      const nextCursor = page.nextCursor === null ? undefined : page.nextCursor;
      if (nextCursor === undefined) break;
      if (nextCursor === cursorKey) {
        console.warn(`元数据分页游标未前进 (${user}): ${nextCursor}`);
        break;
      }
      cursorKey = nextCursor;
    }
  }

  return { candidates: topCandidates.toArray(), total };
}

export async function refreshRecordAndFavorites(): Promise<void> {
  try {
    const ownerUsername = normalizeUsername(getOwnerUsername());
    const users = await db.getAllUsers();
    if (
      ownerUsername &&
      !users.some((user) => normalizeUsername(user) === ownerUsername)
    ) {
      users.push(ownerUsername);
    }

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
    const detailCache = new Map<string, Promise<SearchResult | null>>();
    const retriedDetailKeys = new Set<string>();

    const fetchDetail = (source: string, id: string, fallbackTitle: string) =>
      fetchVideoDetail({
        source,
        id,
        fallbackTitle: fallbackTitle.trim(),
      }).catch((error) => {
        console.error(`获取视频详情失败 (${source}+${id}):`, error);
        return null;
      });

    // 同一作品在本轮只请求一次；失败的详情在重试阶段每个作品至多重新请求一次
    const getDetail: GetDetail = async (source, id, fallbackTitle, retry) => {
      const key = `${source}+${id}`;
      const cached = detailCache.get(key);
      if (!cached) {
        const promise = fetchDetail(source, id, fallbackTitle);
        detailCache.set(key, promise);
        return promise;
      }
      if (!retry || (await cached) || retriedDetailKeys.has(key)) {
        return detailCache.get(key) as Promise<SearchResult | null>;
      }
      retriedDetailKeys.add(key);
      const promise = fetchDetail(source, id, fallbackTitle);
      detailCache.set(key, promise);
      return promise;
    };

    const [recordCollection, favoriteCollection] = await Promise.all([
      collectPagedCandidates(
        users,
        recordMaxItems,
        (user, cursorKey) =>
          db.getStalePlayRecordPage(
            user,
            staleReferenceTime,
            metadataRefreshTtlMs,
            metadataPageSize,
            cursorKey,
          ),
        (user, key, record, snapshot) =>
          buildPlayRecordCandidate(
            user,
            key,
            record,
            staleReferenceTime,
            metadataRefreshTtlMs,
            snapshot,
          ),
        '获取用户播放记录分页失败',
      ),
      collectPagedCandidates(
        users,
        favoriteMaxItems,
        (user, cursorKey) =>
          db.getStaleFavoritePage(
            user,
            staleReferenceTime,
            metadataRefreshTtlMs,
            metadataPageSize,
            cursorKey,
          ),
        (user, key, favorite, snapshot) =>
          buildFavoriteCandidate(
            user,
            key,
            favorite,
            staleReferenceTime,
            metadataRefreshTtlMs,
            snapshot,
          ),
        '获取用户收藏分页失败',
      ),
    ]);

    const recordCandidates = recordCollection.candidates;
    const favoriteCandidates = favoriteCollection.candidates;

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
      PLAY_RECORD_TARGET,
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
      FAVORITE_TARGET,
    );

    console.log(
      `刷新播放记录/收藏任务完成: 记录 ${recordBudget.processed}/${recordCollection.total}，收藏 ${favoriteBudget.processed}/${favoriteCollection.total}`,
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
};

const PLAY_RECORD_TARGET: MetadataTarget<PlayRecord> = {
  label: '播放记录',
  getTitle: (record) => record.title,
  build: (record, detail, checkedAt) =>
    buildRefreshedPlayRecord(record, detail, checkedAt),
  saveIfUnchanged: (user, source, id, next, snapshot) =>
    db.savePlayRecordIfUnchanged(user, source, id, next, snapshot),
};

const FAVORITE_TARGET: MetadataTarget<Favorite> = {
  label: '收藏',
  getTitle: (favorite) => favorite.title,
  build: (favorite, detail, checkedAt) =>
    buildRefreshedFavorite(favorite, detail, checkedAt),
  saveIfUnchanged: (user, source, id, next, snapshot) =>
    db.saveFavoriteIfUnchanged(user, source, id, next, snapshot),
};

export async function refreshMetadataCandidates<T>(
  candidates: Array<MetadataCandidate<T>>,
  budget: MetadataRefreshBudget,
  getDetail: GetDetail,
  target: MetadataTarget<T>,
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

  const failed: Array<{
    candidate: MetadataCandidate<T>;
    source: string;
    id: string;
    checkedAt: number;
  }> = [];
  for (const candidate of candidates) {
    if (!canProcessMetadata(budget)) break;

    const parsed = parseStorageKey(candidate.key);
    if (!parsed) {
      console.warn(`跳过无效的${target.label}键: ${candidate.key}`);
      continue;
    }

    budget.processed += 1;
    const checkedAt = Date.now();
    const detail = await getDetail(
      parsed.source,
      parsed.id,
      target.getTitle(candidate.item),
    );
    if (detail) {
      await save(candidate, parsed.source, parsed.id, detail, checkedAt);
    } else {
      failed.push({ candidate, ...parsed, checkedAt });
    }
  }

  // 获取失败的条目在本轮末尾重试一次，瞬时故障不必再等一个检查周期；
  // 仍失败或预算用尽时只写入检查时间
  for (const { candidate, source, id, checkedAt } of failed) {
    const detail = hasTimeBudget(budget)
      ? await getDetail(source, id, target.getTitle(candidate.item), true)
      : null;
    if (!detail) {
      console.warn(`跳过无法获取详情的${target.label}: ${candidate.key}`);
    }
    await save(candidate, source, id, detail, detail ? Date.now() : checkedAt);
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
