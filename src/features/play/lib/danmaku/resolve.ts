import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import {
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import { applyOffset } from '@/features/play/lib/danmaku/plugin';
import {
  type DanmakuItem,
  DanmakuEpisodeNotFoundError,
} from '@/features/play/lib/danmaku/types';
import {
  buildDanmakuScopeKey,
  readDanmakuEpisodeSearchTitle,
  readDanmakuOffset,
  writeDanmakuEpisodeId,
  writeDanmakuEpisodeSearchTitle,
} from '@/lib/local-preferences';

export type DanmakuEnabledReader = () => boolean;

export interface DanmakuLoadOptions {
  forceRefresh?: boolean;
  onError?: (error?: unknown) => void;
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
          return [];
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
          if (!keyword) return [];
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
      return applyOffset(items, readDanmakuOffset(scopeKey));
    }

    return [];
  } catch (error) {
    console.warn('弹幕加载失败:', error);
    options.onError?.(error);
    return [];
  }
}
