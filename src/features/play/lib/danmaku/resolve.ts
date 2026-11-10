import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import {
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import { downsampleByTime } from '@/features/play/lib/danmaku/normalize';
import { applyOffset } from '@/features/play/lib/danmaku/plugin';
import {
  type DanmakuItem,
  DanmakuEpisodeNotFoundError,
} from '@/features/play/lib/danmaku/types';
import { fetchUserDanmaku } from '@/features/play/lib/danmaku/user-client';
import {
  buildDanmakuScopeKey,
  readDanmakuEpisodeSearchTitle,
  readDanmakuOffset,
  writeDanmakuEpisodeId,
  writeDanmakuEpisodeSearchTitle,
} from '@/lib/local-preferences';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { type UserDanmakuItem, buildUserDanmakuKey } from '@/lib/user-danmaku';

export type DanmakuEnabledReader = () => boolean;

export interface UserDanmakuTarget {
  title?: string;
  year?: string;
  key: string;
  offset: number;
}

export interface DanmakuLoadOptions {
  forceRefresh?: boolean;
  onError?: (error?: unknown) => void;
  // 站点开启用户弹幕时回传本集的发送目标
  onUserTarget?: (target: UserDanmakuTarget) => void;
}

export interface DanmakuLoadContext {
  source: string;
  videoId: string;
  episodeIndex: number;
  searchTitle: string;
  searchYear: string;
}

const MAX_CANDIDATE_ATTEMPTS = 6;

interface EpisodeCandidate {
  episodeId: number;
  persistOnSuccess: boolean;
  keyword: string;
}

async function resolveEpisodeCandidates(
  source: string,
  videoId: string,
  episodeIndex: number,
  searchTitle: string,
  searchYear: string,
  forceRefresh = false,
): Promise<EpisodeCandidate[]> {
  const stored = await getPersistedEpisodeId(source, videoId, episodeIndex);
  if (stored) {
    const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
    const keyword =
      (scopeKey && readDanmakuEpisodeSearchTitle(scopeKey)) || searchTitle;
    return [{ episodeId: stored, persistOnSuccess: false, keyword }];
  }

  if (!searchTitle) return [];

  const candidates = forceRefresh
    ? await searchDanmakuCandidates(searchTitle, undefined, { force: true })
    : await searchDanmakuCandidates(searchTitle);
  return rankCandidatesByEpisode(
    candidates,
    episodeIndex,
    searchTitle,
    searchYear,
  )
    .slice(0, MAX_CANDIDATE_ATTEMPTS)
    .map((candidate) => ({
      episodeId: candidate.episodeId,
      persistOnSuccess: true,
      keyword: searchTitle,
    }));
}

interface ThirdPartyDanmaku {
  items: DanmakuItem[];
  // 已确定的第三方弹幕集，加载失败但有已存映射时仍返回，供用户弹幕定位
  episodeId: number | null;
}

const NO_THIRD_PARTY: ThirdPartyDanmaku = { items: [], episodeId: null };

async function loadThirdPartyDanmaku(
  context: DanmakuLoadContext,
  scopeKey: string,
  options: DanmakuLoadOptions,
): Promise<ThirdPartyDanmaku> {
  try {
    let candidates = await resolveEpisodeCandidates(
      context.source,
      context.videoId,
      context.episodeIndex,
      context.searchTitle,
      context.searchYear,
      options.forceRefresh,
    );

    let candidateIndex = 0;
    while (candidateIndex < candidates.length) {
      const candidate = candidates[candidateIndex];
      candidateIndex += 1;
      let items: DanmakuItem[];
      let missingEpisode = false;
      try {
        items = await fetchDanmakuComments(candidate.episodeId, undefined, {
          force: options.forceRefresh,
          keyword: candidate.keyword,
        });
      } catch (error) {
        if (!(error instanceof DanmakuEpisodeNotFoundError)) {
          options.onError?.(error);
          return {
            items: [],
            episodeId: candidate.persistOnSuccess ? null : candidate.episodeId,
          };
        }
        missingEpisode = true;
        items = [];
      }

      if (items.length === 0) {
        if (!candidate.persistOnSuccess && missingEpisode) {
          // 旧映射已失效，清掉后重新搜索并尝试新的候选。
          await clearPersistedEpisodeId(
            context.source,
            context.videoId,
            context.episodeIndex,
          );
          const keyword = candidate.keyword || context.searchTitle;
          if (!keyword) return NO_THIRD_PARTY;
          const searched = await searchDanmakuCandidates(keyword, undefined, {
            force: missingEpisode,
          });
          candidates = rankCandidatesByEpisode(
            searched,
            context.episodeIndex,
            keyword,
            context.searchYear,
          )
            .filter((item) => item.episodeId !== candidate.episodeId)
            .slice(0, MAX_CANDIDATE_ATTEMPTS)
            .map((item) => ({
              episodeId: item.episodeId,
              persistOnSuccess: true,
              keyword,
            }));
          candidateIndex = 0;
        }
        continue;
      }

      if (candidate.persistOnSuccess) {
        writeDanmakuEpisodeId(scopeKey, candidate.episodeId);
        writeDanmakuEpisodeSearchTitle(scopeKey, candidate.keyword);
      }
      return { items, episodeId: candidate.episodeId };
    }

    return NO_THIRD_PARTY;
  } catch (error) {
    console.warn('弹幕加载失败:', error);
    options.onError?.(error);
    return NO_THIRD_PARTY;
  }
}

function isUserDanmakuEnabled(): boolean {
  return getRuntimeConfig()?.ENABLE_USER_DANMAKU === true;
}

// 用户弹幕优先占用预算，第三方弹幕按剩余额度抽稀，合计不超过单集上限
function mergeUserDanmaku(
  thirdParty: DanmakuItem[],
  userItems: UserDanmakuItem[],
  limit: number,
): DanmakuItem[] {
  if (userItems.length === 0) return thirdParty;
  const budget = limit > 0 ? limit - userItems.length : thirdParty.length;
  const sampled = budget > 0 ? downsampleByTime(thirdParty, budget) : [];
  const merged: DanmakuItem[] = [...sampled];
  for (const item of userItems) {
    merged.push({
      text: item.text,
      time: item.time,
      mode: item.mode,
      color: item.color,
      border: item.mine,
    });
  }
  return merged.sort((a, b) => a.time - b.time);
}

export async function loadDanmakuForEpisode(
  context: DanmakuLoadContext,
  isEnabled: DanmakuEnabledReader,
  options: DanmakuLoadOptions = {},
): Promise<DanmakuItem[]> {
  if (!isEnabled()) return [];

  const scopeKey = buildDanmakuScopeKey(
    context.source,
    context.videoId,
    context.episodeIndex,
  );
  if (!scopeKey) return [];

  const { items, episodeId } = await loadThirdPartyDanmaku(
    context,
    scopeKey,
    options,
  );
  const offset = readDanmakuOffset(scopeKey);
  if (!isUserDanmakuEnabled()) return applyOffset(items, offset);

  const key = buildUserDanmakuKey(episodeId, scopeKey);
  options.onUserTarget?.({
    key,
    offset,
    title: context.searchTitle,
    year: context.searchYear,
  });
  try {
    const user = await fetchUserDanmaku(key);
    return applyOffset(mergeUserDanmaku(items, user.items, user.limit), offset);
  } catch (error) {
    console.warn('用户弹幕加载失败:', error);
    return applyOffset(items, offset);
  }
}
