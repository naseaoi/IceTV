import {
  fetchDanmakuComments,
  pickCandidateByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import { getPersistedEpisodeId } from '@/features/play/lib/danmaku/episode-storage';
import { applyOffset } from '@/features/play/lib/danmaku/plugin';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import {
  buildDanmakuScopeKey,
  readDanmakuEnabled,
  readDanmakuOffset,
  writeDanmakuEpisodeId,
} from '@/lib/local-preferences';

export interface DanmakuLoadContext {
  source: string;
  videoId: string;
  episodeIndex: number;
  searchTitle: string;
}

async function resolveEpisodeId(
  source: string,
  videoId: string,
  episodeIndex: number,
  searchTitle: string,
): Promise<number | null> {
  const stored = await getPersistedEpisodeId(source, videoId, episodeIndex);
  if (stored) return stored;

  if (!searchTitle) return null;

  const candidates = await searchDanmakuCandidates(searchTitle);
  const picked = pickCandidateByEpisode(candidates, episodeIndex);
  if (!picked) return null;

  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (scopeKey) {
    writeDanmakuEpisodeId(scopeKey, picked.episodeId);
  }
  return picked.episodeId;
}

export async function loadDanmakuForEpisode(
  context: DanmakuLoadContext,
): Promise<DanmakuItem[]> {
  if (!readDanmakuEnabled()) return [];

  const scopeKey = buildDanmakuScopeKey(
    context.source,
    context.videoId,
    context.episodeIndex,
  );
  if (!scopeKey) return [];

  try {
    const episodeId = await resolveEpisodeId(
      context.source,
      context.videoId,
      context.episodeIndex,
      context.searchTitle,
    );
    if (!episodeId) return [];

    const items = await fetchDanmakuComments(episodeId);
    return applyOffset(items, readDanmakuOffset(scopeKey));
  } catch (error) {
    console.warn('弹幕加载失败:', error);
    return [];
  }
}
