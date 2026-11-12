import { takeProbeSegmentSample } from '@/features/play/lib/hls-utils';
import {
  createSharedPlaybackTask,
  throwIfPlaybackCancelled,
} from '@/features/play/lib/sharedPlaybackTask';
import { fetchSourceProbe } from '@/features/play/lib/sourceProbeRequest';
import {
  SOURCE_PROBE_CONCURRENCY,
  SOURCE_PROBE_STARTUP_HOLD_MS,
  SourceProbeDeferredError,
} from '@/features/play/lib/sourceProbeRequestPolicy';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import { getProxyModes, getSourcePlaybackRoute } from '@/lib/proxy-modes';
import { reportSourcePlayOutcome } from '@/lib/source-route-stats.client';
import { SearchResult } from '@/lib/types';

export interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

export interface ProbeEntry {
  info: VideoInfo;
  ts: number;
  source: 'probe' | 'player' | 'queued' | 'pending' | 'deferred';
  previousInfo?: VideoInfo;
  retryAt?: number;
  probeIdentity?: string;
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

export function getFreshProbeInfo(
  key: string,
  now = Date.now(),
): VideoInfo | undefined {
  const entry = snapshotRef.get(key);
  // 排队、暂缓和进行中的条目没有新测量；previousInfo 没有原始时间戳，不能续期使用。
  if (
    !entry ||
    (entry.source !== 'probe' && entry.source !== 'player') ||
    now - entry.ts >= PROBE_TTL_MS
  )
    return undefined;
  return entry.info;
}

function deleteEntry(key: string) {
  if (state.entries.delete(key)) emit();
}

export function writePlayerInfo(key: string, info: VideoInfo) {
  setEntry(key, { info, ts: Date.now(), source: 'player' });
}

interface ProbeTask {
  shared: ReturnType<typeof createSharedPlaybackTask<VideoInfo | undefined>>;
  options: ProbeOptions;
}
const inflight = new Map<string, ProbeTask>();
const probeQueue: Array<{ options: ProbeOptions; grant: () => void }> = [];
let activeProbeCount = 0;
let startupHoldTimer: ReturnType<typeof setTimeout> | undefined;

export function holdBackgroundSourceProbes() {
  if (startupHoldTimer) clearTimeout(startupHoldTimer);
  startupHoldTimer = setTimeout(
    releaseBackgroundSourceProbes,
    SOURCE_PROBE_STARTUP_HOLD_MS,
  );
}

export function releaseBackgroundSourceProbes() {
  if (startupHoldTimer) clearTimeout(startupHoldTimer);
  startupHoldTimer = undefined;
  drainProbeQueue();
}

function drainProbeQueue() {
  while (activeProbeCount < SOURCE_PROBE_CONCURRENCY) {
    const index = probeQueue.findIndex(
      ({ options }) => !startupHoldTimer || options.force || options.foreground,
    );
    if (index < 0) return;
    probeQueue.splice(index, 1)[0].grant();
  }
}

interface ProbeOptions {
  force?: boolean;
  foreground?: boolean;
  onDetailFetched?: (updated: SearchResult) => void;
  episodeIndex?: number | null;
  // 初始化只复用相同目标集及线路；面板只消费源级指标，可以跟随任意集的在途任务。
  probeIdentity?: string;
  signal?: AbortSignal;
  probe?: (signal: AbortSignal) => Promise<VideoInfo>;
  shouldSkip?: () => boolean;
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
): Promise<VideoInfo | undefined> {
  if (options.signal?.aborted) return;
  const key = `${sourceInput.source}-${sourceInput.id}`;
  const existing = inflight.get(key);
  if (existing && !existing.shared.signal.aborted) {
    if (options.force || options.foreground) {
      existing.options.foreground = true;
      drainProbeQueue();
    }
    // 面板不把结果当作目标集可播证明；初始化遇到异集任务先等其结束，再测自己的目标集。
    if (
      !options.probeIdentity ||
      existing.options.probeIdentity === options.probeIdentity
    )
      return consumeProbe(existing.shared, options.signal);
    await consumeProbe(existing.shared, options.signal);
    return getOrProbe(sourceInput, options);
  }

  const now = Date.now();
  const entry = state.entries.get(key);
  if (entry?.source === 'deferred' && (entry.retryAt ?? 0) > now) return;
  if (!options.force && entry) {
    if (entry.source === 'player') return;
    if (
      entry.source === 'probe' &&
      !entry.info.hasError &&
      now - entry.ts < PROBE_TTL_MS &&
      (!options.probeIdentity || entry.probeIdentity === options.probeIdentity)
    )
      return entry.info;
  }

  const taskOptions = { ...options };
  const shared = createSharedPlaybackTask(async (signal) => {
    try {
      taskOptions.signal = signal;
      return await runProbe(key, sourceInput, taskOptions);
    } finally {
      if (inflight.get(key)?.shared === shared) inflight.delete(key);
    }
  });
  inflight.set(key, { shared, options: taskOptions });
  return consumeProbe(shared, options.signal);
}

async function consumeProbe(
  task: ProbeTask['shared'],
  signal?: AbortSignal,
): Promise<VideoInfo | undefined> {
  try {
    return await task.consume(signal);
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') throw error;
  }
}

function acquireProbeSlot(options: ProbeOptions): Promise<() => void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      const index = probeQueue.findIndex((entry) => entry.grant === grant);
      if (index >= 0) probeQueue.splice(index, 1);
      resolve(() => undefined);
    };
    const grant = () => {
      options.signal?.removeEventListener('abort', onAbort);
      activeProbeCount += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeProbeCount -= 1;
        drainProbeQueue();
      });
    };
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    probeQueue.push({ options, grant });
    drainProbeQueue();
  });
}

async function runProbe(
  key: string,
  sourceInput: SearchResult,
  options: ProbeOptions,
) {
  const isCurrentTask = () => inflight.get(key)?.options === options;
  const existingEntry = state.entries.get(key);
  const previousInfo =
    existingEntry?.source === 'pending' ||
    existingEntry?.source === 'queued' ||
    existingEntry?.source === 'deferred'
      ? existingEntry.previousInfo
      : existingEntry?.info;

  setEntry(key, {
    info: { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
    ts: Date.now(),
    source: 'queued',
    previousInfo,
  });

  let releaseProbeSlot = await acquireProbeSlot(options);
  // 失败回调可能先放行、同一调用栈又自动换源；真正发请求前再次确认闸门。
  while (
    !options.signal?.aborted &&
    startupHoldTimer &&
    !options.force &&
    !options.foreground
  ) {
    releaseProbeSlot();
    releaseProbeSlot = await acquireProbeSlot(options);
  }
  if (
    options.signal?.aborted ||
    options.shouldSkip?.() ||
    (!options.force && state.entries.get(key)?.source === 'player')
  ) {
    if (isCurrentTask() && state.entries.get(key)?.source === 'queued')
      deleteEntry(key);
    releaseProbeSlot();
    return;
  }
  setEntry(key, {
    info: { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
    ts: Date.now(),
    source: 'pending',
    previousInfo,
  });

  const writeProbeEntry = (info: VideoInfo) => {
    // 真实播放的信息优先于更早发起、迟到完成的测速。
    if (isCurrentTask() && state.entries.get(key)?.source !== 'player')
      setEntry(key, {
        info,
        ts: Date.now(),
        source: 'probe',
        probeIdentity: options.probeIdentity,
      });
  };

  try {
    throwIfPlaybackCancelled(options.signal);
    if (options.probe) {
      try {
        const info = await options.probe(options.signal!);
        throwIfPlaybackCancelled(options.signal);
        writeProbeEntry(info);
        return info;
      } catch (error) {
        if (
          options.signal?.aborted ||
          navigator.onLine === false ||
          options.shouldSkip?.() ||
          (error as Error)?.name === 'AbortError'
        ) {
          if (isCurrentTask() && state.entries.get(key)?.source === 'pending')
            deleteEntry(key);
          return;
        }
        if (error instanceof SourceProbeDeferredError) throw error;
        const info = {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        };
        writeProbeEntry(info);
        return info;
      }
    }
    let resolved = sourceInput;
    if (!resolved.episodes || resolved.episodes.length === 0) {
      try {
        const res = await fetchSourceProbe(
          `/api/detail?source=${resolved.source}&id=${resolved.id}`,
          { signal: options.signal },
        );
        if (res.ok) {
          const full = (await res.json()) as SearchResult;
          throwIfPlaybackCancelled(options.signal);
          if (full.episodes && full.episodes.length > 0) {
            resolved = full;
            options.onDetailFetched?.(full);
          }
        }
      } catch (error) {
        if (error instanceof SourceProbeDeferredError) throw error;
      }
    }

    const proxyModes = await getProxyModes();
    throwIfPlaybackCancelled(options.signal);
    let route = getSourcePlaybackRoute(resolved.source, undefined, proxyModes);
    if (!resolved.episodes || resolved.episodes.length === 0) {
      reportSourcePlayOutcome(resolved.source, false);
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
      route = getSourcePlaybackRoute(
        resolved.source,
        probeEpisodeUrl,
        proxyModes,
      );
      const info = await probeVodEpisodeUrl(
        probeEpisodeUrl,
        route,
        resolved.source,
        options.signal,
      );
      throwIfPlaybackCancelled(options.signal);
      // 换源面板的测速不用于起播，首分片样本立即释放
      takeProbeSegmentSample(info);
      reportSourcePlayOutcome(resolved.source, true);
      writeProbeEntry(info);
      return info;
    } catch (error) {
      if (error instanceof SourceProbeDeferredError) throw error;
      throwIfPlaybackCancelled(options.signal);
      if ((error as Error)?.name === 'AbortError') throw error;
      reportSourcePlayOutcome(resolved.source, false);
      writeProbeEntry({
        quality: '错误',
        loadSpeed: '未知',
        pingTime: 0,
        hasError: true,
      });
    }
  } catch (error) {
    if (
      options.signal?.aborted ||
      navigator.onLine === false ||
      (error as Error)?.name === 'AbortError'
    ) {
      if (state.entries.get(key)?.source === 'pending') deleteEntry(key);
      return;
    }
    if (!(error instanceof SourceProbeDeferredError)) throw error;
    if (state.entries.get(key)?.source === 'player') return;
    const retainedInfo = previousInfo?.hasError ? undefined : previousInfo;
    setEntry(key, {
      info: retainedInfo ?? { quality: '未知', loadSpeed: '未知', pingTime: 0 },
      ts: Date.now(),
      source: 'deferred',
      previousInfo: retainedInfo,
      retryAt: Date.now() + error.retryAfterSeconds * 1000,
    });
  } finally {
    releaseProbeSlot();
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
  now = Date.now(),
) {
  let mutated = false;
  const iter = results[Symbol.iterator]();
  while (true) {
    const { done, value } = iter.next();
    if (done) break;
    const [key, info] = value;
    // 预计算结果没有测量时间，只补空位，避免覆盖面板新结果或给旧结果续期。
    if (state.entries.has(key)) continue;
    state.entries.set(key, { info, ts: now, source: 'probe' });
    mutated = true;
  }
  if (mutated) emit();
}

emit();
