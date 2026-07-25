import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import type { Favorite, PlayRecord, SearchResult } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const DEFAULT_METADATA_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_REFRESH_MAX_ITEMS = 100;
const DEFAULT_METADATA_REFRESH_TIME_BUDGET_MS = 30 * 1000;

type MetadataRefreshBudget = {
  startedAt: number;
  maxItems: number;
  timeBudgetMs: number;
  processed: number;
};

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
    const metadataRefreshBudget = createMetadataRefreshBudget();
    const refreshStartedAt = Date.now();
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string,
    ): Promise<SearchResult | null> => {
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

    for (const user of users) {
      if (!canProcessMetadata(metadataRefreshBudget)) {
        break;
      }

      await refreshUserPlayRecords(
        user,
        refreshStartedAt,
        metadataRefreshTtlMs,
        metadataRefreshBudget,
        getDetail,
      );

      if (!canProcessMetadata(metadataRefreshBudget)) {
        break;
      }

      await refreshUserFavorites(
        user,
        refreshStartedAt,
        metadataRefreshTtlMs,
        metadataRefreshBudget,
        getDetail,
      );
    }

    console.log(
      `刷新播放记录/收藏任务完成: ${metadataRefreshBudget.processed}/${metadataRefreshBudget.maxItems}`,
    );
  } catch (error) {
    console.error('刷新播放记录/收藏任务启动失败', error);
  }
}

async function refreshUserPlayRecords(
  user: string,
  refreshStartedAt: number,
  metadataRefreshTtlMs: number,
  metadataRefreshBudget: MetadataRefreshBudget,
  getDetail: GetDetail,
): Promise<void> {
  try {
    const playRecords = await db.getAllPlayRecords(user);
    const totalRecords = Object.keys(playRecords).length;
    let processedRecords = 0;

    for (const [key, record] of Object.entries(playRecords)) {
      if (!canProcessMetadata(metadataRefreshBudget)) {
        break;
      }

      try {
        const parsed = parseStorageKey(key);
        if (!parsed) {
          console.warn(`跳过无效的播放记录键: ${key}`);
          continue;
        }

        if (
          !shouldRefreshMetadata(
            record.metadata_checked_at,
            refreshStartedAt,
            metadataRefreshTtlMs,
          )
        ) {
          continue;
        }

        metadataRefreshBudget.processed += 1;
        const checkedAt = Date.now();
        let nextRecord: PlayRecord = {
          ...record,
          metadata_checked_at: checkedAt,
        };
        const detail = await getDetail(parsed.source, parsed.id, record.title);

        if (!detail) {
          console.warn(`跳过无法获取详情的播放记录: ${key}`);
        } else {
          const episodeCount = detail.episodes?.length || 0;
          if (episodeCount > 0 && episodeCount !== record.total_episodes) {
            nextRecord = {
              ...nextRecord,
              title: detail.title || record.title,
              cover: detail.poster || record.cover,
              total_episodes: episodeCount,
              year: detail.year || record.year,
            };
            console.log(
              `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`,
            );
          }
        }

        await db.savePlayRecord(user, parsed.source, parsed.id, nextRecord);
        processedRecords += 1;
      } catch (error) {
        console.error(`处理播放记录失败 (${key}):`, error);
      }
    }

    console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
  } catch (error) {
    console.error(`获取用户播放记录失败 (${user}):`, error);
  }
}

async function refreshUserFavorites(
  user: string,
  refreshStartedAt: number,
  metadataRefreshTtlMs: number,
  metadataRefreshBudget: MetadataRefreshBudget,
  getDetail: GetDetail,
): Promise<void> {
  try {
    const favorites = Object.fromEntries(
      Object.entries(await db.getAllFavorites(user)).filter(
        ([, favorite]) => favorite.origin !== 'live',
      ),
    );
    const totalFavorites = Object.keys(favorites).length;
    let processedFavorites = 0;

    for (const [key, favorite] of Object.entries(favorites)) {
      if (!canProcessMetadata(metadataRefreshBudget)) {
        break;
      }

      try {
        const parsed = parseStorageKey(key);
        if (!parsed) {
          console.warn(`跳过无效的收藏键: ${key}`);
          continue;
        }

        if (
          !shouldRefreshMetadata(
            favorite.metadata_checked_at,
            refreshStartedAt,
            metadataRefreshTtlMs,
          )
        ) {
          continue;
        }

        metadataRefreshBudget.processed += 1;
        const checkedAt = Date.now();
        let nextFavorite: Favorite = {
          ...favorite,
          metadata_checked_at: checkedAt,
        };
        const detail = await getDetail(
          parsed.source,
          parsed.id,
          favorite.title,
        );

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
        processedFavorites += 1;
      } catch (error) {
        console.error(`处理收藏失败 (${key}):`, error);
      }
    }

    console.log(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);
  } catch (error) {
    console.error(`获取用户收藏失败 (${user}):`, error);
  }
}

type GetDetail = (
  source: string,
  id: string,
  fallbackTitle: string,
) => Promise<SearchResult | null>;

function createMetadataRefreshBudget(): MetadataRefreshBudget {
  return {
    startedAt: Date.now(),
    maxItems: readPositiveInteger(
      process.env.CRON_METADATA_MAX_ITEMS,
      DEFAULT_METADATA_REFRESH_MAX_ITEMS,
    ),
    timeBudgetMs: readPositiveInteger(
      process.env.CRON_METADATA_TIME_BUDGET_MS,
      DEFAULT_METADATA_REFRESH_TIME_BUDGET_MS,
    ),
    processed: 0,
  };
}

function canProcessMetadata(budget: MetadataRefreshBudget): boolean {
  return (
    budget.processed < budget.maxItems &&
    Date.now() - budget.startedAt < budget.timeBudgetMs
  );
}

function shouldRefreshMetadata(
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

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
