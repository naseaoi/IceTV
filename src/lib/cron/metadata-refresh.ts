import {
  type MetadataCandidate,
  collectFavoriteCandidates,
  collectPlayRecordCandidates,
  sortMetadataCandidates,
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
import type { Favorite, PlayRecord, SearchResult } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const DEFAULT_METADATA_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_METADATA_RECORD_MAX_ITEMS = 80;
const DEFAULT_METADATA_FAVORITE_MAX_ITEMS = 40;
const DEFAULT_METADATA_REFRESH_TIME_BUDGET_MS = 5 * 60 * 1000;
const RECORD_TIME_BUDGET_RATIO = 0.7;

type MetadataRefreshBudget = {
  startedAt: number;
  maxItems: number;
  timeBudgetMs: number;
  processed: number;
};

type GetDetail = (
  source: string,
  id: string,
  fallbackTitle: string,
) => Promise<SearchResult | null>;

export async function refreshRecordAndFavorites(): Promise<void> {
  try {
    const ownerUsername = getOwnerUsername();
    const users = await db.getAllUsers();
    if (ownerUsername && !users.includes(ownerUsername)) {
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
    const startedAt = Date.now();
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    const getDetail: GetDetail = async (source, id, fallbackTitle) => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        }).catch((error) => {
          console.error(`获取视频详情失败 (${source}+${id}):`, error);
          return null;
        });
        detailCache.set(key, promise);
      }
      return promise;
    };

    const [recordCandidates, favoriteCandidates] = await Promise.all([
      collectAllPlayRecordCandidates(users, startedAt, metadataRefreshTtlMs),
      collectAllFavoriteCandidates(users, startedAt, metadataRefreshTtlMs),
    ]);

    // 播放记录与收藏各自独立预算，避免其中一方吃满预算导致另一方长期不刷新
    const recordBudget: MetadataRefreshBudget = {
      startedAt,
      maxItems: readPositiveInteger(
        process.env.CRON_METADATA_RECORD_MAX_ITEMS ||
          process.env.CRON_METADATA_MAX_ITEMS,
        DEFAULT_METADATA_RECORD_MAX_ITEMS,
      ),
      timeBudgetMs: Math.floor(totalTimeBudgetMs * RECORD_TIME_BUDGET_RATIO),
      processed: 0,
    };
    await refreshPlayRecordCandidates(
      recordCandidates,
      recordBudget,
      getDetail,
    );

    const favoriteBudget: MetadataRefreshBudget = {
      startedAt,
      maxItems: readPositiveInteger(
        process.env.CRON_METADATA_FAVORITE_MAX_ITEMS,
        DEFAULT_METADATA_FAVORITE_MAX_ITEMS,
      ),
      timeBudgetMs: totalTimeBudgetMs,
      processed: 0,
    };
    await refreshFavoriteCandidates(
      favoriteCandidates,
      favoriteBudget,
      getDetail,
    );

    console.log(
      `刷新播放记录/收藏任务完成: 记录 ${recordBudget.processed}/${recordCandidates.length}，收藏 ${favoriteBudget.processed}/${favoriteCandidates.length}`,
    );
  } catch (error) {
    console.error('刷新播放记录/收藏任务启动失败', error);
  }
}

async function collectAllPlayRecordCandidates(
  users: string[],
  now: number,
  ttlMs: number,
): Promise<Array<MetadataCandidate<PlayRecord>>> {
  const collected: Array<MetadataCandidate<PlayRecord>> = [];

  for (const user of users) {
    try {
      const records = await db.getAllPlayRecords(user);
      collected.push(...collectPlayRecordCandidates(user, records, now, ttlMs));
    } catch (error) {
      console.error(`获取用户播放记录失败 (${user}):`, error);
    }
  }

  return sortMetadataCandidates(collected);
}

async function refreshPlayRecordCandidates(
  candidates: Array<MetadataCandidate<PlayRecord>>,
  budget: MetadataRefreshBudget,
  getDetail: GetDetail,
): Promise<void> {
  for (const candidate of candidates) {
    if (!canProcessMetadata(budget)) {
      break;
    }

    const { user, key, item: record } = candidate;
    try {
      const parsed = parseStorageKey(key);
      if (!parsed) {
        console.warn(`跳过无效的播放记录键: ${key}`);
        continue;
      }

      budget.processed += 1;
      const checkedAt = Date.now();
      const detail = await getDetail(parsed.source, parsed.id, record.title);
      if (!detail) {
        console.warn(`跳过无法获取详情的播放记录: ${key}`);
      }

      const nextRecord = buildRefreshedPlayRecord(record, detail, checkedAt);
      await db.savePlayRecord(user, parsed.source, parsed.id, nextRecord);
    } catch (error) {
      console.error(`处理播放记录失败 (${key}):`, error);
    }
  }
}

async function refreshFavoriteCandidates(
  candidates: Array<MetadataCandidate<Favorite>>,
  budget: MetadataRefreshBudget,
  getDetail: GetDetail,
): Promise<void> {
  for (const candidate of candidates) {
    if (!canProcessMetadata(budget)) {
      break;
    }

    const { user, key, item: favorite } = candidate;
    try {
      const parsed = parseStorageKey(key);
      if (!parsed) {
        console.warn(`跳过无效的收藏键: ${key}`);
        continue;
      }

      budget.processed += 1;
      const checkedAt = Date.now();
      const detail = await getDetail(parsed.source, parsed.id, favorite.title);
      let nextFavorite: Favorite = {
        ...favorite,
        metadata_checked_at: checkedAt,
      };

      if (!detail) {
        console.warn(`跳过无法获取详情的收藏: ${key}`);
      } else {
        const episodeCount = detail.episodes?.length || 0;
        if (episodeCount > 0 && episodeCount !== favorite.total_episodes) {
          nextFavorite = {
            ...nextFavorite,
            title: detail.title || favorite.title,
            cover: detail.poster || favorite.cover,
            year: detail.year || favorite.year,
            total_episodes: episodeCount,
          };
          console.log(
            `更新收藏: ${favorite.title} (${favorite.total_episodes} -> ${episodeCount})`,
          );
        }
      }

      await db.saveFavorite(user, parsed.source, parsed.id, nextFavorite);
    } catch (error) {
      console.error(`处理收藏失败 (${key}):`, error);
    }
  }
}

async function collectAllFavoriteCandidates(
  users: string[],
  now: number,
  ttlMs: number,
): Promise<Array<MetadataCandidate<Favorite>>> {
  const collected: Array<MetadataCandidate<Favorite>> = [];

  for (const user of users) {
    try {
      const favorites = await db.getAllFavorites(user);
      collected.push(...collectFavoriteCandidates(user, favorites, now, ttlMs));
    } catch (error) {
      console.error(`获取用户收藏失败 (${user}):`, error);
    }
  }

  return sortMetadataCandidates(collected);
}

function canProcessMetadata(budget: MetadataRefreshBudget): boolean {
  return (
    budget.processed < budget.maxItems &&
    Date.now() - budget.startedAt < budget.timeBudgetMs
  );
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
