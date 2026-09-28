'use client';

import {
  buildDanmakuScopeKey,
  readDanmakuEpisodeId,
  readDanmakuEpisodeSearchTitle,
  writeDanmakuEpisodeId,
  writeDanmakuEpisodeSearchTitle,
} from '@/lib/local-preferences';

export interface DanmakuEpisodeScope {
  source: string;
  videoId: string;
  episodeIndex: number;
}

async function fetchEpisodeIdFromServer(
  scopeKey: string,
): Promise<number | null> {
  try {
    const response = await fetch(
      `/api/danmaku/episode-mapping?scopeKey=${encodeURIComponent(scopeKey)}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { episodeId: number | null };
    return data.episodeId;
  } catch {
    return null;
  }
}

async function saveEpisodeIdToServer(
  scopeKey: string,
  episodeId: number,
): Promise<boolean> {
  try {
    const response = await fetch('/api/danmaku/episode-mapping', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeKey, episodeId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function deleteEpisodeIdFromServer(scopeKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/danmaku/episode-mapping?scopeKey=${encodeURIComponent(scopeKey)}`,
      {
        method: 'DELETE',
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function getPersistedEpisodeId(
  source: string,
  videoId: string,
  episodeIndex: number,
): Promise<number | null> {
  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (!scopeKey) return null;

  const localId = readDanmakuEpisodeId(scopeKey);
  if (localId !== null) {
    return localId;
  }

  const serverId = await fetchEpisodeIdFromServer(scopeKey);
  if (serverId !== null) {
    writeDanmakuEpisodeId(scopeKey, serverId);
  }
  return serverId;
}

export async function persistEpisodeId(
  source: string,
  videoId: string,
  episodeIndex: number,
  episodeId: number,
  searchTitle?: string,
): Promise<void> {
  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (!scopeKey) return;

  writeDanmakuEpisodeId(scopeKey, episodeId);
  if (searchTitle !== undefined)
    writeDanmakuEpisodeSearchTitle(scopeKey, searchTitle);
  await saveEpisodeIdToServer(scopeKey, episodeId);
}

export async function clearPersistedEpisodeId(
  source: string,
  videoId: string,
  episodeIndex: number,
): Promise<void> {
  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (!scopeKey) return;

  writeDanmakuEpisodeId(scopeKey, null);
  await deleteEpisodeIdFromServer(scopeKey);
}

// 映射按源隔离，换到其他源的同一集时沿用换源前匹配到的弹幕剧集；不沿用的话按新源标题重搜，标题格式不同就匹配不到
export function carryOverDanmakuEpisodeMapping(
  from: DanmakuEpisodeScope[],
  to: DanmakuEpisodeScope,
): boolean {
  const targetKey = buildDanmakuScopeKey(
    to.source,
    to.videoId,
    to.episodeIndex,
  );
  if (!targetKey || readDanmakuEpisodeId(targetKey) !== null) return false;

  for (const scope of from) {
    const scopeKey = buildDanmakuScopeKey(
      scope.source,
      scope.videoId,
      scope.episodeIndex,
    );
    if (!scopeKey || scopeKey === targetKey) continue;
    const episodeId = readDanmakuEpisodeId(scopeKey);
    if (episodeId === null) continue;
    writeDanmakuEpisodeId(targetKey, episodeId);
    writeDanmakuEpisodeSearchTitle(
      targetKey,
      readDanmakuEpisodeSearchTitle(scopeKey),
    );
    return true;
  }
  return false;
}
