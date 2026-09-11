'use client';

import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import { getPersistedEpisodeId } from '@/features/play/lib/danmaku/episode-storage';
import type { DanmakuLoadContext } from '@/features/play/lib/danmaku/resolve';
import { DanmakuEpisodeNotFoundError } from '@/features/play/lib/danmaku/types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  buildDanmakuScopeKey,
  readDanmakuEpisodeSearchTitle,
  readStoredDanmakuEnabled,
} from '@/lib/local-preferences';
import { getRuntimeConfig } from '@/lib/runtime-config';

const WARMUP_TTL_MS = 60 * 1000;
const WARMUP_MAX = 12;
const WARMUP_CANDIDATE_LIMIT = 2;

interface WarmupEntry {
  expiresAt: number;
  promise: Promise<void>;
}

interface PreferenceEntry {
  username: string;
  enabled: boolean;
}

const warmups = new Map<string, WarmupEntry>();
const navigationWarmupTitles = new Map<string, number>();
let preference: PreferenceEntry | null = null;
let preferenceRequest: {
  username: string;
  promise: Promise<boolean>;
} | null = null;

function trimWarmups(): void {
  while (warmups.size > WARMUP_MAX) {
    const oldest = warmups.keys().next().value;
    if (!oldest) return;
    warmups.delete(oldest);
  }
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function markNavigationWarmupTitle(title: string): void {
  const key = normalizeTitle(title);
  if (!key) return;
  navigationWarmupTitles.set(key, Date.now() + WARMUP_TTL_MS);
  while (navigationWarmupTitles.size > WARMUP_MAX) {
    const oldest = navigationWarmupTitles.keys().next().value;
    if (!oldest) return;
    navigationWarmupTitles.delete(oldest);
  }
}

function clearNavigationWarmupTitle(title: string): void {
  const key = normalizeTitle(title);
  if (key) navigationWarmupTitles.delete(key);
}

export function hasDanmakuNavigationWarmup(title: string): boolean {
  const key = normalizeTitle(title);
  if (!key) return false;
  const expiresAt = navigationWarmupTitles.get(key);
  if (!expiresAt) return false;
  if (expiresAt > Date.now()) return true;
  navigationWarmupTitles.delete(key);
  return false;
}

function buildWarmupKey(context: DanmakuLoadContext): string {
  return JSON.stringify([
    context.source.trim(),
    context.videoId.trim(),
    context.episodeIndex,
    context.searchTitle.trim(),
    context.searchYear.trim(),
  ]);
}

async function runWarmup(context: DanmakuLoadContext): Promise<void> {
  const source = context.source.trim();
  const videoId = context.videoId.trim();
  const scopeKey = buildDanmakuScopeKey(source, videoId, context.episodeIndex);
  const searchTitle =
    (scopeKey && readDanmakuEpisodeSearchTitle(scopeKey)) ||
    context.searchTitle.trim();
  let storedEpisodeId: number | null = null;

  if (source && videoId) {
    storedEpisodeId = await getPersistedEpisodeId(
      source,
      videoId,
      context.episodeIndex,
    );
    if (storedEpisodeId !== null) {
      try {
        const storedItems = await fetchDanmakuComments(
          storedEpisodeId,
          undefined,
          { keyword: searchTitle },
        );
        if (storedItems.length > 0) return;
      } catch (error) {
        if (!(error instanceof DanmakuEpisodeNotFoundError)) throw error;
      }
    }
  }

  if (!searchTitle) return;

  const candidates = await warmupDanmakuTitleSearch(searchTitle);
  const ranked = rankCandidatesByEpisode(
    candidates,
    context.episodeIndex,
    searchTitle,
    context.searchYear,
  )
    .filter((candidate) => candidate.episodeId !== storedEpisodeId)
    .slice(0, WARMUP_CANDIDATE_LIMIT);

  for (const candidate of ranked) {
    const items = await fetchDanmakuComments(candidate.episodeId, undefined, {
      keyword: searchTitle,
    });
    if (items.length > 0) return;
  }
}

async function warmupDanmakuTitleSearch(searchTitle: string) {
  markNavigationWarmupTitle(searchTitle);
  let candidates: Awaited<ReturnType<typeof searchDanmakuCandidates>>;
  try {
    candidates = await searchDanmakuCandidates(searchTitle);
  } catch (error) {
    clearNavigationWarmupTitle(searchTitle);
    throw error;
  }
  return candidates;
}

export function warmupDanmakuData(context: DanmakuLoadContext): Promise<void> {
  if (getRuntimeConfig()?.ENABLE_DANMAKU !== true) {
    return Promise.resolve();
  }
  if (!Number.isSafeInteger(context.episodeIndex) || context.episodeIndex < 0) {
    return Promise.resolve();
  }

  const key = buildWarmupKey(context);
  const now = Date.now();
  const cached = warmups.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) warmups.delete(key);

  const promise = runWarmup(context).catch(() => {
    if (warmups.get(key)?.promise === promise) warmups.delete(key);
  });
  warmups.set(key, { expiresAt: now + WARMUP_TTL_MS, promise });
  trimWarmups();
  return promise;
}

function readAccountPreference(username: string): Promise<boolean> {
  if (preference?.username === username) {
    return Promise.resolve(preference.enabled);
  }
  if (preferenceRequest?.username === username) {
    return preferenceRequest.promise;
  }

  const promise = fetch('/api/danmaku/settings', {
    credentials: 'same-origin',
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = (await response.json()) as { enabled?: unknown };
      const enabled =
        typeof payload.enabled === 'boolean'
          ? payload.enabled
          : (readStoredDanmakuEnabled() ?? false);
      if (preferenceRequest?.promise === promise) {
        preference = { username, enabled };
      }
      return enabled;
    })
    .catch(() => false)
    .finally(() => {
      if (preferenceRequest?.promise === promise) preferenceRequest = null;
    });

  preferenceRequest = { username, promise };
  return promise;
}

async function canWarmupForCurrentAccount(): Promise<boolean> {
  if (getRuntimeConfig()?.ENABLE_DANMAKU !== true) return false;

  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username) return false;

  const enabled = await readAccountPreference(username);
  return preference?.username === username ? preference.enabled : enabled;
}

export function updateDanmakuWarmupPreference(enabled: boolean): void {
  const username = getAuthInfoFromBrowserCookie()?.username;
  if (!username) {
    preference = null;
    preferenceRequest = null;
    return;
  }

  preference = { username, enabled };
  preferenceRequest = null;
}

export async function warmupDanmakuForNavigation(
  context: DanmakuLoadContext,
): Promise<void> {
  if (!(await canWarmupForCurrentAccount())) return;

  await warmupDanmakuData(context);
}

export async function warmupDanmakuSearchForNavigation(
  searchTitle: string,
): Promise<void> {
  const title = searchTitle.trim();
  if (!title || !(await canWarmupForCurrentAccount())) return;

  try {
    await warmupDanmakuTitleSearch(title);
  } catch {}
}
