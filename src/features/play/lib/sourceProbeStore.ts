/**
 * 换源列表测速状态 store（模块级单例 + 订阅通知）
 * ----------------------------------------------------------------------------
 * 背景：此前 SourcesTab 使用 React state + 模块级缓存混搭，存在两个顽疾：
 *   1. 并发测速中途的「测量中...」仅写入 state，不进缓存；SourcesTab 被父组件
 *      重渲染链路影响时，state 合并失败，已完成的 C/D/E 结果也像丢失一样。
 *   2. 没有显式取消点，pending 与 attempted 标记被 Ref 管理，极易错配。
 * 改造：把「当前测速状态」收敛到单一 store，组件通过 useSyncExternalStore 订阅。
 *   - pending/success/error 三态都写入 store，不会再凭空消失。
 *   - 播放器实时 bwEstimate 也写入同一把锁，UI 展示始终与最新真实速度一致。
 *   - 提供幂等的 getOrProbe，以及可控的 reset（对应「检验全部」）。
 */
import { getVideoResolutionFromM3u8 } from '@/lib/hls-utils';
import { getProxyModes, shouldUseServerProxy } from '@/lib/proxy-modes';
import { SearchResult } from '@/lib/types';

export interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

export interface ProbeEntry {
  info: VideoInfo;
  /** 写入时间戳，用于 TTL 判定 */
  ts: number;
  /** 数据来源：测速探针 / 播放器实时 / 占位 */
  source: 'probe' | 'player' | 'pending';
}

/** 命中 TTL 后才会被视为过期；播放器数据永不被 probe 覆盖 */
export const PROBE_TTL_MS = 10 * 60_000;

interface StoreState {
  entries: Map<string, ProbeEntry>;
}

const state: StoreState = {
  entries: new Map(),
};

const listeners = new Set<() => void>();

// 发出给 React 的快照；useSyncExternalStore 会用 Object.is 比较引用变化
let snapshotRef: ReadonlyMap<string, ProbeEntry> = new Map();

function emit() {
  snapshotRef = new Map(state.entries);
  listeners.forEach((fn) => fn());
}

function setEntry(key: string, entry: ProbeEntry) {
  state.entries.set(key, entry);
  emit();
}

function deleteEntry(key: string) {
  if (state.entries.delete(key)) emit();
}

// ---------------------------------------------------------------------------
// 对外只读 API
// ---------------------------------------------------------------------------

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ReadonlyMap<string, ProbeEntry> {
  return snapshotRef;
}

export function getInfo(key: string): VideoInfo | undefined {
  const entry = state.entries.get(key);
  if (!entry) return undefined;
  // 播放器实时数据永远视为最新，不走 TTL
  if (entry.source === 'player') return entry.info;
  if (Date.now() - entry.ts > PROBE_TTL_MS) return undefined;
  return entry.info;
}

// ---------------------------------------------------------------------------
// 写入：播放器实时数据
// ---------------------------------------------------------------------------

/**
 * 播放器起播/加载过程中把 hls.js 的真实带宽写回。
 * 这份数据比探针准确，会覆盖任何 probe 结果。
 */
export function writePlayerInfo(key: string, info: VideoInfo) {
  setEntry(key, { info, ts: Date.now(), source: 'player' });
}

// ---------------------------------------------------------------------------
// 测速：幂等 + 去重
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<void>>();

interface ProbeOptions {
  /** 是否强制重测，忽略 TTL */
  force?: boolean;
  /** 当 episodes 为空时补全 detail 的回调 */
  onDetailFetched?: (updated: SearchResult) => void;
  /** 当前逻辑集映射到目标源后的待测速集索引；null 表示当前集不可测 */
  episodeIndex?: number | null;
}

export function resolveRequestedProbeEpisodeUrl(
  source: SearchResult,
  episodeIndex: number | null | undefined,
): string | null {
  if (episodeIndex === null) {
    return null;
  }

  const safeEpisodeIndex = Number.isInteger(episodeIndex)
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
      // 播放器数据优先，不重测
      if (existed.source === 'player') return;
      if (
        existed.source === 'probe' &&
        !existed.info.hasError &&
        now - existed.ts < PROBE_TTL_MS
      ) {
        return;
      }
      // pending 态下由对应 promise 决定
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
  // 占位：立即让 UI 显示"检测中"
  setEntry(key, {
    info: { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
    ts: Date.now(),
    source: 'pending',
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
    const useProxy = shouldUseServerProxy(resolved.source, proxyModes);
    const probeEpisodeUrl = resolveRequestedProbeEpisodeUrl(
      resolved,
      options.episodeIndex,
    );
    if (!probeEpisodeUrl) {
      throw new Error('Requested episode is unavailable for probe');
    }
    const info = await getVideoResolutionFromM3u8(
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

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

/** 「检验全部」时用：清空全部非 player 的缓存，让 UI 立即显示测量中 */
export function resetProbes(preservePlayerKeys: Iterable<string> = []) {
  const preserve = new Set(preservePlayerKeys);
  for (const [key, entry] of Array.from(state.entries.entries())) {
    if (entry.source === 'player' && preserve.has(key)) continue;
    state.entries.delete(key);
  }
  emit();
}

/** 针对单个源清空，常用于「重试」 */
export function invalidateProbe(key: string) {
  deleteEntry(key);
}

/** 预填：搜索阶段已完成的聚合优选结果可以先灌入，避免重复测 */
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

// 初始化快照（避免首次 getSnapshot 返回 undefined）
emit();
