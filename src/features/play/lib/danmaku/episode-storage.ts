'use client';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
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

const missingMappings = new Map<string, number>();
const mappingRequests = new Map<string, Promise<number | null>>();
const MISSING_MAPPING_TTL_MS = 30_000;

function getAccount(): string {
  return getAuthInfoFromBrowserCookie()?.username ?? '';
}

function mappingCacheKey(scopeKey: string, account = getAccount()): string {
  return JSON.stringify([account, scopeKey]);
}

function invalidateMapping(key: string): void {
  missingMappings.delete(key);
  mappingRequests.delete(key);
}

async function fetchEpisodeIdFromServer(
  scopeKey: string,
): Promise<number | null | undefined> {
  try {
    const response = await fetch(
      `/api/danmaku/episode-mapping?scopeKey=${encodeURIComponent(scopeKey)}`,
    );
    if (!response.ok) return undefined;
    const data = (await response.json()) as { episodeId: number | null };
    return data.episodeId === null ||
      (Number.isInteger(data.episodeId) && Number(data.episodeId) > 0)
      ? data.episodeId
      : undefined;
  } catch {
    return undefined;
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

  const account = getAccount();
  const key = mappingCacheKey(scopeKey, account);
  const now = Date.now();
  for (const [cachedKey, expiresAt] of missingMappings) {
    if (expiresAt <= now) missingMappings.delete(cachedKey);
  }
  if (missingMappings.has(key)) return null;
  const pending = mappingRequests.get(key);
  if (pending) return pending;

  const task = fetchEpisodeIdFromServer(scopeKey)
    .then((serverId) => {
      // 绑定、清除或账号切换后，迟到读取不能回写旧映射。
      if (mappingRequests.get(key) !== task || account !== getAccount())
        return account === getAccount() ? readDanmakuEpisodeId(scopeKey) : null;
      if (serverId === null) {
        missingMappings.set(key, Date.now() + MISSING_MAPPING_TTL_MS);
        if (missingMappings.size > 200)
          missingMappings.delete(missingMappings.keys().next().value!);
      } else if (serverId !== undefined) {
        writeDanmakuEpisodeId(scopeKey, serverId);
      }
      return serverId ?? null;
    })
    .finally(() => {
      if (mappingRequests.get(key) === task) mappingRequests.delete(key);
    });
  mappingRequests.set(key, task);
  return task;
}

export async function persistEpisodeId(
  source: string,
  videoId: string,
  episodeIndex: number,
  episodeId: number,
  searchTitle?: string,
): Promise<boolean> {
  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (!scopeKey) return false;

  const account = getAccount();
  const key = mappingCacheKey(scopeKey, account);
  invalidateMapping(key);
  const ok = await saveEpisodeIdToServer(scopeKey, episodeId);
  invalidateMapping(key);
  if (!ok || account !== getAccount()) return false;
  const saved = writeDanmakuEpisodeId(scopeKey, episodeId);
  const titleSaved =
    searchTitle === undefined ||
    writeDanmakuEpisodeSearchTitle(scopeKey, searchTitle);
  return saved && titleSaved;
}

export async function clearPersistedEpisodeId(
  source: string,
  videoId: string,
  episodeIndex: number,
): Promise<boolean> {
  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
  if (!scopeKey) return false;

  const account = getAccount();
  const key = mappingCacheKey(scopeKey, account);
  invalidateMapping(key);
  const ok = await deleteEpisodeIdFromServer(scopeKey);
  invalidateMapping(key);
  if (!ok || account !== getAccount()) return false;
  return writeDanmakuEpisodeId(scopeKey, null);
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
    invalidateMapping(mappingCacheKey(targetKey));
    writeDanmakuEpisodeId(targetKey, episodeId);
    writeDanmakuEpisodeSearchTitle(
      targetKey,
      readDanmakuEpisodeSearchTitle(scopeKey),
    );
    return true;
  }
  return false;
}
