import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { getConfig, refineConfig, saveConfig } from '@/lib/config';
import {
  decodeConfigSubscriptionContent,
  readConfigSubscriptionText,
} from '@/lib/config-subscription';
import { acquireCronLease } from '@/lib/cron-lease';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { Favorite, PlayRecord, SearchResult } from '@/lib/types';
import { fetchWithUrlGuard } from '@/lib/url-guard';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

type CronTask = 'all' | 'config' | 'live' | 'metadata';
const DEFAULT_METADATA_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_REFRESH_MAX_ITEMS = 100;
const DEFAULT_METADATA_REFRESH_TIME_BUDGET_MS = 30 * 1000;
const DEFAULT_PLAYBACK_STATS_RETENTION_DAYS = 0;
const MAX_PLAYBACK_STATS_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

type MetadataRefreshBudget = {
  startedAt: number;
  maxItems: number;
  timeBudgetMs: number;
  processed: number;
};

let cronRunning = false;

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPlaybackStatsRetentionDays(): number {
  const parsed = Number.parseInt(
    process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS || '',
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PLAYBACK_STATS_RETENTION_DAYS;
  }
  return Math.min(parsed, MAX_PLAYBACK_STATS_RETENTION_DAYS);
}

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

export async function GET(request: NextRequest) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const task = getCronTask(request);
    if (!task) {
      return NextResponse.json({ error: 'Invalid cron task' }, { status: 400 });
    }

    if (cronRunning) {
      return NextResponse.json(
        {
          success: false,
          task,
          message: 'Cron job is already running',
          timestamp: new Date().toISOString(),
        },
        { status: 202 },
      );
    }

    cronRunning = true;
    let lease;
    try {
      lease = await acquireCronLease();
    } catch (error) {
      cronRunning = false;
      console.error('Cron lease acquisition failed:', error);
      return NextResponse.json(
        {
          success: false,
          task,
          message: 'Cron job lease is unavailable',
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }

    if (!lease) {
      cronRunning = false;
      return NextResponse.json(
        {
          success: false,
          task,
          message: 'Cron job is already running in another process',
          timestamp: new Date().toISOString(),
        },
        { status: 202 },
      );
    }

    console.log(`Cron job triggered [${task}]:`, new Date().toISOString());

    cronJob(task)
      .catch((err) => console.error('Cron job background error:', err))
      .finally(async () => {
        await lease.release();
        cronRunning = false;
      });

    return NextResponse.json({
      success: true,
      task,
      message: 'Cron job executed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

function getCronTask(request: NextRequest): CronTask | null {
  const task = new URL(request.url).searchParams.get('task');
  if (!task || task === 'all') return 'all';
  if (task === 'config' || task === 'live' || task === 'metadata') {
    return task;
  }
  return null;
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || '';

  if (!secret) {
    return false;
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  return safeEqual(token, secret);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function cronJob(task: CronTask) {
  if (task === 'all' || task === 'config') {
    await refreshConfig();
  }
  if (task === 'all' || task === 'live') {
    await refreshAllLiveChannels();
  }
  if (task === 'all' || task === 'metadata') {
    await refreshRecordAndFavorites();
    await cleanupPlaybackSessions();
  }
}

async function cleanupPlaybackSessions() {
  const retentionDays = readPlaybackStatsRetentionDays();
  if (retentionDays <= 0) {
    return;
  }

  const cutoff = Date.now() - retentionDays * DAY_MS;
  const deleted = await db.deletePlaybackSessionsBefore(cutoff);
  if (deleted > 0) {
    console.log(
      `播放统计清理完成：删除 ${deleted} 条超过 ${retentionDays} 天且未更新的会话`,
    );
  }
}

async function refreshAllLiveChannels() {
  const config = await getConfig();
  if (!isLiveEntryEnabledInConfig(config)) {
    return;
  }

  await refreshLiveChannelSources(config.LiveConfig || []);

  await saveConfig(config);
}

async function refreshConfig() {
  let config = await getConfig();
  if (
    config &&
    config.ConfigSubscribtion &&
    config.ConfigSubscribtion.URL &&
    config.ConfigSubscribtion.AutoUpdate
  ) {
    try {
      const response = await fetchWithUrlGuard(config.ConfigSubscribtion.URL);

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const configContent = await readConfigSubscriptionText(response);

      let decodedContent;
      try {
        decodedContent = await decodeConfigSubscriptionContent(configContent);
      } catch (decodeError) {
        console.warn('Base58 解码失败:', decodeError);
        throw decodeError;
      }

      try {
        JSON.parse(decodedContent);
      } catch {
        throw new Error('配置文件格式错误，请检查 JSON 语法');
      }
      config.ConfigFile = decodedContent;
      config.ConfigSubscribtion.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await saveConfig(config);
    } catch (e) {
      console.error('刷新配置失败:', e);
    }
  } else {
    console.log('跳过刷新：未配置订阅地址或自动更新');
  }
}

async function refreshRecordAndFavorites() {
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
        }).catch((err) => {
          console.error(`获取视频详情失败 (${source}+${id}):`, err);
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

            const detail = await getDetail(
              parsed.source,
              parsed.id,
              record.title,
            );
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
            processedRecords++;
          } catch (err) {
            console.error(`处理播放记录失败 (${key}):`, err);
          }
        }

        console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`获取用户播放记录失败 (${user}):`, err);
      }

      if (!canProcessMetadata(metadataRefreshBudget)) {
        break;
      }

      try {
        const favorites = Object.fromEntries(
          Object.entries(await db.getAllFavorites(user)).filter(
            ([, fav]) => fav.origin !== 'live',
          ),
        );
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;

        for (const [key, fav] of Object.entries(favorites)) {
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
                fav.metadata_checked_at,
                refreshStartedAt,
                metadataRefreshTtlMs,
              )
            ) {
              continue;
            }

            metadataRefreshBudget.processed += 1;
            const checkedAt = Date.now();
            let nextFavorite: Favorite = {
              ...fav,
              metadata_checked_at: checkedAt,
            };
            const favDetail = await getDetail(
              parsed.source,
              parsed.id,
              fav.title,
            );

            if (!favDetail) {
              console.warn(`跳过无法获取详情的收藏: ${key}`);
            } else {
              const favEpisodeCount = favDetail.episodes?.length || 0;
              if (
                favEpisodeCount > 0 &&
                favEpisodeCount !== fav.total_episodes
              ) {
                nextFavorite = {
                  ...nextFavorite,
                  title: favDetail.title || fav.title,
                  cover: favDetail.poster || fav.cover,
                  year: favDetail.year || fav.year,
                  total_episodes: favEpisodeCount,
                };
                console.log(
                  `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`,
                );
              }
            }

            await db.saveFavorite(user, parsed.source, parsed.id, nextFavorite);
            processedFavorites++;
          } catch (err) {
            console.error(`处理收藏失败 (${key}):`, err);
          }
        }

        console.log(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`获取用户收藏失败 (${user}):`, err);
      }
    }

    console.log(
      `刷新播放记录/收藏任务完成: ${metadataRefreshBudget.processed}/${metadataRefreshBudget.maxItems}`,
    );
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}
