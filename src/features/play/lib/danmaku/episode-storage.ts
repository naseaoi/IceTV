'use client';

import {
  buildDanmakuScopeKey,
  readDanmakuEpisodeId,
  writeDanmakuEpisodeId,
} from '@/lib/local-preferences';

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
): Promise<void> {
  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (!scopeKey) return;

  writeDanmakuEpisodeId(scopeKey, episodeId);
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
