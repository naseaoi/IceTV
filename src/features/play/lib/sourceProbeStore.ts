import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import { getProxyModes, shouldUseServerProxy } from '@/lib/proxy-modes';
import { SearchResult } from '@/lib/types';

import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';

export interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

export interface ProbeEntry {
  info: VideoInfo;
  ts: number;
  source: 'probe' | 'player' | 'pending';
  previousInfo?: VideoInfo;
}

const PROBE_TTL_MS = 10 * 60_000;

interface StoreState {
  entries: Map<string, ProbeEntry>;
}

const state: StoreState = {
  entries: new Map(),
};

const listeners = new Set<() => void>();

let snapshotRef: ReadonlyMap<string, ProbeEntry> = new Map();

function emit() {
  snapshotRef = new Map(state.entries);
  listeners.forEach((fn) => fn());
}

function setEntry(key: string, entry: ProbeEntry) {
  state.entries.set(key, entry);
  emit();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ReadonlyMap<string, ProbeEntry> {
  return snapshotRef;
}

function deleteEntry(key: string) {
  if (state.entries.delete(key)) emit();
}

export function writePlayerInfo(key: string, info: VideoInfo) {
  setEntry(key, { info, ts: Date.now(), source: 'player' });
}

const inflight = new Map<string, Promise<void>>();

interface ProbeOptions {
  force?: boolean;
  onDetailFetched?: (updated: SearchResult) => void;
  episodeIndex?: number | null;
}

export function resolveRequestedProbeEpisodeUrl(
  source: SearchResult,
  episodeIndex: number | null | undefined,
): string | null {
  if (episodeIndex === null) {
    return null;
  }

  const safeEpisodeIndex =
    typeof episodeIndex === 'number' && Number.isInteger(episodeIndex)
      ? Math.max(0, episodeIndex)
      : 0;

  if (safeEpisodeIndex >= source.episodes.length) {
    return null;
  }

  return source.episodes[safeEpisodeIndex] || null;
}

export async function getOrProbe(
  sourceInput: SearchResult,
  options: ProbeOptions = {},
) {
  const key = `${sourceInput.source}-${sourceInput.id}`;
  const now = Date.now();

  if (!options.force) {
    const existed = state.entries.get(key);
    if (existed) {
      if (existed.source === 'player') return;
      if (
        existed.source === 'probe' &&
        !existed.info.hasError &&
        now - existed.ts < PROBE_TTL_MS
      ) {
        return;
      }
    }
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = runProbe(key, sourceInput, options).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

async function runProbe(
  key: string,
  sourceInput: SearchResult,
  options: ProbeOptions,
) {
  const existingEntry = state.entries.get(key);
  const previousInfo =
    existingEntry?.source === 'pending'
      ? existingEntry.previousInfo
      : existingEntry?.info;

  setEntry(key, {
    info: { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
    ts: Date.now(),
    source: 'pending',
    previousInfo,
  });

  let resolved = sourceInput;
  if (!resolved.episodes || resolved.episodes.length === 0) {
    try {
      const res = await fetch(
        `/api/detail?source=${resolved.source}&id=${resolved.id}`,
      );
      if (res.ok) {
        const full = (await res.json()) as SearchResult;
        if (full.episodes && full.episodes.length > 0) {
          resolved = full;
          options.onDetailFetched?.(full);
        }
      }
    } catch {
      /* 忽略 */
    }
  }

  if (!resolved.episodes || resolved.episodes.length === 0) {
    setEntry(key, {
      info: {
        quality: '未知',
        loadSpeed: '未知',
        pingTime: 0,
        hasError: true,
      },
      ts: Date.now(),
      source: 'probe',
    });
    return;
  }

  try {
    const proxyModes = await getProxyModes();
    let probeEpisodeUrl = resolveRequestedProbeEpisodeUrl(
      resolved,
      options.episodeIndex,
    );
    // 懒地址源只解析第 1 集用于测速
    if (probeEpisodeUrl && isLazyEpisodeUrl(probeEpisodeUrl)) {
      probeEpisodeUrl = resolved.episodes[0] || probeEpisodeUrl;
    }
    if (!probeEpisodeUrl) {
      throw new Error('Requested episode is unavailable for probe');
    }
    const useProxy = shouldUseServerProxy(
      resolved.source,
      probeEpisodeUrl,
      proxyModes,
    );
    const info = await probeVodEpisodeUrl(
      probeEpisodeUrl,
      useProxy,
      resolved.source,
    );
    setEntry(key, { info, ts: Date.now(), source: 'probe' });
  } catch {
    setEntry(key, {
      info: {
        quality: '错误',
        loadSpeed: '未知',
        pingTime: 0,
        hasError: true,
      },
      ts: Date.now(),
      source: 'probe',
    });
  }
}

export function resetProbes(preservePlayerKeys: Iterable<string> = []) {
  const preserve = new Set(preservePlayerKeys);
  for (const [key, entry] of Array.from(state.entries.entries())) {
    if (entry.source === 'player' && preserve.has(key)) continue;
    state.entries.delete(key);
  }
  emit();
}

export function invalidateProbe(key: string) {
  deleteEntry(key);
}

export function seedProbeResults(
  results: Iterable<readonly [string, VideoInfo]>,
) {
  const now = Date.now();
  let mutated = false;
  const iter = results[Symbol.iterator]();
  while (true) {
    const { done, value } = iter.next();
    if (done) break;
    const [key, info] = value;
    const existed = state.entries.get(key);
    if (existed?.source === 'player') continue;
    state.entries.set(key, { info, ts: now, source: 'probe' });
    mutated = true;
  }
  if (mutated) emit();
}

emit();
