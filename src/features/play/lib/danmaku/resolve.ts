import {
  fetchDanmakuComments,
  pickCandidateByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import { applyOffset } from '@/features/play/lib/danmaku/plugin';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import {
  buildDanmakuScopeKey,
  readDanmakuEnabled,
  readDanmakuEpisodeId,
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
  scopeKey: string,
  searchTitle: string,
  episodeIndex: number,
): Promise<number | null> {
  const stored = readDanmakuEpisodeId(scopeKey);
  if (stored) return stored;

  if (!searchTitle) return null;

  const candidates = await searchDanmakuCandidates(searchTitle);
  const picked = pickCandidateByEpisode(candidates, episodeIndex);
  if (!picked) return null;

  writeDanmakuEpisodeId(scopeKey, picked.episodeId);
  return picked.episodeId;
}

// 关闭状态下不发请求，开启时由设置项触发重载
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
      scopeKey,
      context.searchTitle,
      context.episodeIndex,
    );
    if (!episodeId) return [];

    const items = await fetchDanmakuComments(episodeId);
    return applyOffset(items, readDanmakuOffset(scopeKey));
  } catch (error) {
    console.warn('弹幕加载失败:', error);
    return [];
  }
}
