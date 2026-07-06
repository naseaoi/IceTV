import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannels,
} from '@/features/live/lib/live';
import { getConfig, refineConfig, saveConfig } from '@/lib/config';
import {
  decodeConfigSubscriptionContent,
  readConfigSubscriptionText,
} from '@/lib/config-subscription';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { SearchResult } from '@/lib/types';
import { fetchWithUrlGuard } from '@/lib/url-guard';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Cron job triggered:', new Date().toISOString());

    cronJob().catch((err) => console.error('Cron job background error:', err));

    return NextResponse.json({
      success: true,
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

function isCronAuthorized(request: NextRequest): boolean {
  const secret =
    process.env.CRON_SECRET ||
    process.env.ICETV_CRON_SECRET ||
    process.env.VERCEL_CRON_SECRET ||
    '';

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

async function cronJob() {
  await refreshConfig();
  await refreshAllLiveChannels();
  await refreshRecordAndFavorites();
}

async function refreshAllLiveChannels() {
  const config = await getConfig();
  if (!isLiveEntryEnabledInConfig(config)) {
    return;
  }

  const refreshPromises = (config.LiveConfig || [])
    .filter((liveInfo) => !liveInfo.disabled)
    .map(async (liveInfo) => {
      try {
        const nums = await refreshLiveChannels(liveInfo);
        liveInfo.channelNumber = nums;
      } catch (error) {
        console.error(
          `刷新直播源失败 [${liveInfo.name || liveInfo.key}]:`,
          error,
        );
        liveInfo.channelNumber = 0;
      }
    });

  await Promise.all(refreshPromises);

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
        })
          .then((detail) => {
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            console.error(`获取视频详情失败 (${source}+${id}):`, err);
            return null;
          });
      }
      return promise;
    };

    for (const user of users) {
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const totalRecords = Object.keys(playRecords).length;
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const parsed = parseStorageKey(key);
            if (!parsed) {
              console.warn(`跳过无效的播放记录键: ${key}`);
              continue;
            }

            const detail = await getDetail(
              parsed.source,
              parsed.id,
              record.title,
            );
            if (!detail) {
              console.warn(`跳过无法获取详情的播放记录: ${key}`);
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await db.savePlayRecord(user, parsed.source, parsed.id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
              });
              console.log(
                `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`,
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`处理播放记录失败 (${key}):`, err);
          }
        }

        console.log(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`获取用户播放记录失败 (${user}):`, err);
      }

      try {
        let favorites = await db.getAllFavorites(user);
        favorites = Object.fromEntries(
          Object.entries(favorites).filter(([_, fav]) => fav.origin !== 'live'),
        );
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const parsed = parseStorageKey(key);
            if (!parsed) {
              console.warn(`跳过无效的收藏键: ${key}`);
              continue;
            }

            const favDetail = await getDetail(
              parsed.source,
              parsed.id,
              fav.title,
            );
            if (!favDetail) {
              console.warn(`跳过无法获取详情的收藏: ${key}`);
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, parsed.source, parsed.id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.log(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`,
              );
            }

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

    console.log('刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}
