import type Artplayer from 'artplayer';
import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useMemo,
} from 'react';
import { useCallback, useRef } from 'react';

import { resolveEpisodeGroupPosition } from '@/features/play/lib/episodeGroups';
import {
  buildEpisodeProgressKeys,
  getPlaybackRecordsRetryDelay,
  isFinishedWhenLeavingForNext,
  MIN_WATCHED_SECONDS,
  resolveEpisodeProgressResumeTime,
} from '@/features/play/lib/episodeProgress';
import {
  type PlaybackStartTarget,
  decidePlaybackStart,
  START_DETAIL_WAIT_MS,
} from '@/features/play/lib/playbackStartPolicy';
import {
  type PlaybackStartState,
  clearPlaybackStartState,
} from '@/features/play/lib/playbackStartState';
import {
  hasExplicitPlaybackSeek,
  hasMeaningfulPlaybackTime,
  isPlaybackCheckpointCompatibleWithDetail,
  isPlayRecordCompatibleWithDetail,
  readMatchingPlaybackCheckpoint,
  resolvePlaybackRestoreCandidate,
  resolveSavedPlaybackTime,
  savePlaybackCheckpoint,
  shouldApplyHistoryRestore,
} from '@/features/play/lib/playProgressRestore';
import {
  SessionLostReason,
  WakeLockSentinel,
} from '@/features/play/lib/playTypes';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import {
  applyResumeTime,
  isFinishedResumeTarget,
} from '@/features/play/lib/resumePlayback';
import { createScreenWakeLockController } from '@/features/play/lib/screenWakeLock';
import {
  generateStorageKey,
  PlayRecord,
  readPlayRecordsForPlayback,
  reportPlaybackRecordsReadFailure,
  savePlayRecord,
} from '@/lib/db.client';
import { remapEpisodeIndexToDetail } from '@/lib/episode-groups';
import {
  type EpisodeProgressEntry,
  createEpisodeProgressEntry,
} from '@/lib/episode-progress';
import { readAutoPlayNextEnabled } from '@/lib/local-preferences';
import { consumeMatchingPlayIntent } from '@/lib/play-intent';
import { SearchResult, SkipConfig } from '@/lib/types';

export {
  clearPlaybackCheckpointStorage,
  hasMeaningfulPlaybackTime,
  isPlaybackCheckpointCompatibleWithDetail,
  isPlayRecordCompatibleWithDetail,
  resolveNextStablePlaybackTime,
  resolvePlaybackRestoreCandidate,
  resolveProtectedPlaybackTime,
  savePlaybackCheckpoint,
  shouldApplyHistoryRestore,
} from '@/features/play/lib/playProgressRestore';

// ---------------------------------------------------------------------------
// 保存播放进度
// ---------------------------------------------------------------------------

type PendingPlayProgressSave = {
  source: string;
  id: string;
  record: PlayRecord;
  fingerprint: string;
};

export interface PlayProgressSaveState {
  sessionId?: string;
  sequence?: number;
  lastSnapshotTime?: number;
  inFlight: boolean;
  pending: Map<string, PendingPlayProgressSave>;
  lastSavedFingerprint: string | null;
  activeFingerprints?: Set<string>;
  latestSaveToken?: object;
  onSaved?: (source: string, id: string) => void | Promise<void>;
  // 每个新快照同步通知，切集时本地每集进度表不必等保存请求返回
  onEpisodeProgress?: (entry: EpisodeProgressEntry) => void;
}

function buildPlayProgressFingerprint(
  source: string,
  id: string,
  record: PlayRecord,
): string {
  return [source, id, record.index, record.play_time, record.total_time].join(
    '|',
  );
}

async function persistPlayProgressSave(
  state: PlayProgressSaveState,
  lastSaveTimeRef: MutableRefObject<number>,
  payload: PendingPlayProgressSave,
): Promise<void> {
  const active = (state.activeFingerprints ??= new Set());
  if (
    active.has(payload.fingerprint) ||
    payload.fingerprint === state.lastSavedFingerprint
  ) {
    return;
  }
  active.add(payload.fingerprint);
  lastSaveTimeRef.current = Date.now();
  const token = {};
  state.latestSaveToken = token;
  try {
    await savePlayRecord(payload.source, payload.id, payload.record);
    if (state.latestSaveToken === token) {
      state.lastSavedFingerprint = payload.fingerprint;
    }
    await state.onSaved?.(payload.source, payload.id);
  } catch (err) {
    console.error('保存播放进度失败:', err);
  } finally {
    active.delete(payload.fingerprint);
  }
}

async function flushPendingPlayProgress(
  state: PlayProgressSaveState,
  lastSaveTimeRef: MutableRefObject<number>,
  immediate: boolean,
): Promise<void> {
  if (immediate) {
    // 退出时同步启动每个 keepalive 请求，不能等上一个响应才发送下一集。
    const pending = [...state.pending.values()];
    state.pending.clear();
    await Promise.all(
      pending.map((payload) =>
        persistPlayProgressSave(state, lastSaveTimeRef, payload),
      ),
    );
    return;
  }
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    for (const [key, payload] of state.pending) {
      state.pending.delete(key);
      await persistPlayProgressSave(state, lastSaveTimeRef, payload);
    }
  } finally {
    state.inFlight = false;
  }
}

export async function saveCurrentPlayProgress(
  artPlayerRef: MutableRefObject<Artplayer | null>,
  currentSourceRef: MutableRefObject<string>,
  currentIdRef: MutableRefObject<string>,
  videoTitleRef: MutableRefObject<string>,
  detailRef: MutableRefObject<SearchResult | null>,
  currentEpisodeIndexRef: MutableRefObject<number>,
  stableCurrentTimeRef: MutableRefObject<number>,
  clearTargetEpisodeProgressRef: MutableRefObject<boolean>,
  saveStateRef: MutableRefObject<PlayProgressSaveState>,
  lastSaveTimeRef: MutableRefObject<number>,
  searchTitle: string,
  immediate = false,
  leavingForNext = false,
) {
  const state = saveStateRef.current;
  if (
    !artPlayerRef.current ||
    !currentSourceRef.current ||
    !currentIdRef.current ||
    !videoTitleRef.current ||
    !detailRef.current?.source_name ||
    // 目标集尚未真正起播前，禁止把上一集的时间写进当前集记录。
    clearTargetEpisodeProgressRef.current
  ) {
    if (immediate) await flushPendingPlayProgress(state, lastSaveTimeRef, true);
    return;
  }

  const player = artPlayerRef.current;
  const currentTime = resolveSavedPlaybackTime(
    player.currentTime || 0,
    stableCurrentTimeRef,
  );
  const duration = player.duration || 0;

  // 播放时间太短或视频时长无效，不保存
  if (!hasMeaningfulPlaybackTime(currentTime) || !duration) {
    if (immediate) await flushPendingPlayProgress(state, lastSaveTimeRef, true);
    return;
  }

  // 分组源（如 giri 繁中/简中）记录组内集数，供继续观看卡片展示组内进度
  const groupPosition = resolveEpisodeGroupPosition(
    detailRef.current?.episode_groups,
    currentEpisodeIndexRef.current,
    detailRef.current?.episodes.length || 0,
  );
  const groupLabel = groupPosition
    ? detailRef.current?.episode_groups?.[groupPosition.groupIndex]?.label
    : undefined;

  const record: PlayRecord = {
    title: videoTitleRef.current,
    source_name: detailRef.current?.source_name || '',
    year: detailRef.current?.year,
    cover: detailRef.current?.poster || '',
    index: currentEpisodeIndexRef.current + 1,
    total_episodes: detailRef.current?.episodes.length || 1,
    series_status: detailRef.current?.series_status,
    ...(groupPosition
      ? {
          group_index: groupPosition.episodeOffset + 1,
          group_total: groupPosition.groupCount,
          ...(groupLabel ? { group_label: groupLabel } : {}),
        }
      : {}),
    play_time: Math.floor(
      leavingForNext && isFinishedWhenLeavingForNext(currentTime, duration)
        ? duration
        : currentTime,
    ),
    total_time: Math.floor(duration),
    save_time: Date.now(),
    search_title: searchTitle,
  };
  const episodeKey = buildEpisodeProgressKeys(detailRef.current)[
    currentEpisodeIndexRef.current
  ];
  if (episodeKey && record.play_time >= MIN_WATCHED_SECONDS) {
    record.episode_key = episodeKey;
  }

  const fingerprint = buildPlayProgressFingerprint(
    currentSourceRef.current,
    currentIdRef.current,
    record,
  );

  const key = `${generateStorageKey(currentSourceRef.current, currentIdRef.current)}|${record.index}`;
  if (fingerprint === state.lastSavedFingerprint && !state.pending.has(key)) {
    if (immediate) await flushPendingPlayProgress(state, lastSaveTimeRef, true);
    return;
  }

  // 并发补写同一集时按采样时间取最新，避免同一毫秒内的两个快照平局。
  record.save_time = state.lastSnapshotTime = Math.max(
    record.save_time,
    (state.lastSnapshotTime ?? 0) + 1,
  );
  const episodeEntry =
    record.episode_key &&
    createEpisodeProgressEntry(record.episode_key, record);
  if (episodeEntry) state.onEpisodeProgress?.(episodeEntry);
  state.sessionId ??=
    typeof globalThis.crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  record.progress_session_id = state.sessionId;
  record.progress_sequence = state.sequence = (state.sequence ?? 0) + 1;

  // 同集仅保留最新快照，并按最新的采样顺序排队。
  state.pending.delete(key);
  state.pending.set(key, {
    source: currentSourceRef.current,
    id: currentIdRef.current,
    record,
    fingerprint,
  });
  await flushPendingPlayProgress(state, lastSaveTimeRef, immediate);
}

// 起播前凭恢复点和已拿到的播放记录预判续播的集，取舍规则与 initFromHistory 一致
// 不看播放意图：它读取即删除，且带意图的入口都已指定源，不经过测速选源
export function peekHistoryRestoreEpisodeIndex(
  detail: SearchResult,
  playRecords: Record<string, PlayRecord> | null,
): number | null {
  const checkpoint = readMatchingPlaybackCheckpoint(
    { current: detail.source },
    { current: detail.id },
  );
  const record = playRecords?.[generateStorageKey(detail.source, detail.id)];
  const restoreCandidate = resolvePlaybackRestoreCandidate({
    checkpoint: isPlaybackCheckpointCompatibleWithDetail(checkpoint, detail)
      ? checkpoint
      : null,
    record: isPlayRecordCompatibleWithDetail(record, detail)
      ? record
      : undefined,
    episodeCount: detail.episodes?.length || 0,
    episodeGroups: detail.episode_groups,
  });
  return restoreCandidate ? restoreCandidate.episodeIndex : null;
}

// ---------------------------------------------------------------------------
// 起播与历史恢复的握手
// ---------------------------------------------------------------------------

// 起播等历史恢复写好续播的集与时间再放行；起播前提前发起的播放记录读取交给这次恢复复用
export interface HistoryRestoreGate {
  startDecision?: Promise<void>;
  detailRefresh?: { key: string; promise: Promise<SearchResult | null> };
  playRecords: Promise<Record<string, PlayRecord>> | null;
  // playRecords 来自本地缓存时的网络核对结果；缓存可能落后于其他设备
  playRecordsFresh?: Promise<Record<string, PlayRecord>> | null;
  settledKey: string;
  listeners: Set<(key: string) => void>;
  // 正在等权威播放记录的作品与集；起播等待超时后按默认集播放，这段进度不能覆盖还没读到的记录
  pending?: { key: string; episodeIndex: number } | null;
}

function getHistoryRestoreKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 用户选了别的集或拖动过进度，恢复会被放弃，这段进度属于用户自己的选择，可以保存
function isProgressWriteBlocked(
  gate: HistoryRestoreGate,
  source: string,
  id: string,
  episodeIndex: number,
  stableTime: MutableRefObject<number>,
): boolean {
  const pending = gate.pending;
  return (
    pending?.key === getHistoryRestoreKey(source, id) &&
    pending.episodeIndex === episodeIndex &&
    !hasExplicitPlaybackSeek(stableTime)
  );
}

function isNewerPlayRecord(
  fresh: PlayRecord | undefined,
  previous: PlayRecord | undefined,
): fresh is PlayRecord {
  return !!fresh && (!previous || fresh.save_time > previous.save_time);
}

function settleHistoryRestore(gate: HistoryRestoreGate, key: string) {
  gate.settledKey = key;
  gate.listeners.forEach((listener) => listener(key));
}

export function waitForHistoryRestore(
  gate: HistoryRestoreGate,
  target: Pick<SearchResult, 'source' | 'id'>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const key = getHistoryRestoreKey(target.source, target.id);
  if (gate.settledKey === key) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      gate.listeners.delete(onSettled);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const onSettled = (settledKey: string) => {
      if (settledKey === key) finish();
    };
    const timer = setTimeout(() => {
      if (gate.startDecision) void gate.startDecision.then(finish);
      else finish();
    }, timeoutMs);
    gate.listeners.add(onSettled);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

// ---------------------------------------------------------------------------
// usePlayProgress hook — 组合所有进度管理相关 effect
// ---------------------------------------------------------------------------

interface UsePlayProgressParams {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  videoTitleRef: MutableRefObject<string>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  resumeTimeRef: MutableRefObject<number | null>;
  resumeModeRef: MutableRefObject<ResumeMode>;
  allowAutoResumeRef: MutableRefObject<boolean>;
  stableCurrentTimeRef: MutableRefObject<number>;
  clearTargetEpisodeProgressRef: MutableRefObject<boolean>;
  saveStateRef: MutableRefObject<PlayProgressSaveState>;
  lastSaveTimeRef: MutableRefObject<number>;
  saveIntervalRef: MutableRefObject<NodeJS.Timeout | null>;
  wakeLockRef: MutableRefObject<WakeLockSentinel | null>;
  historyRestoreGateRef: MutableRefObject<HistoryRestoreGate>;
  searchTitle: string;
  currentSource: string;
  currentId: string;
  currentEpisodeIndex: number;
  detail: SearchResult | null;
  autoPlayNextEnabledRef?: MutableRefObject<boolean>;
  skipConfigRef?: MutableRefObject<SkipConfig>;
  getEpisodeEntry?: (index: number) => EpisodeProgressEntry | undefined;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  onRestoreEpisodeChange?: () => void;
  // 起播恢复读到的当前作品记录（含缺失），供每集进度表复用，避免重复读取
  onPlayRecordLoaded?: (key: string, record: PlayRecord | undefined) => void;
  cleanupPlayer: () => void;
}

export function usePlayProgress({
  artPlayerRef,
  currentSourceRef,
  currentIdRef,
  videoTitleRef,
  detailRef,
  currentEpisodeIndexRef,
  resumeTimeRef,
  resumeModeRef,
  allowAutoResumeRef,
  stableCurrentTimeRef,
  clearTargetEpisodeProgressRef,
  saveStateRef,
  lastSaveTimeRef,
  saveIntervalRef,
  wakeLockRef,
  historyRestoreGateRef,
  searchTitle,
  currentSource,
  currentId,
  detail,
  autoPlayNextEnabledRef,
  skipConfigRef,
  getEpisodeEntry,
  setCurrentEpisodeIndex,
  onRestoreEpisodeChange,
  onPlayRecordLoaded,
  cleanupPlayer,
}: UsePlayProgressParams) {
  const detailReady =
    !!detail?.episodes.length &&
    detail.source === currentSource &&
    detail.id === currentId;
  const getEpisodeEntryRef = useRef(getEpisodeEntry);
  getEpisodeEntryRef.current = getEpisodeEntry;
  const searchTitleRef = useRef(searchTitle);
  const onPlayRecordLoadedRef = useRef(onPlayRecordLoaded);
  useEffect(() => {
    onPlayRecordLoadedRef.current = onPlayRecordLoaded;
  }, [onPlayRecordLoaded]);
  const restoreAppliedKeyRef = useRef('');
  // 意图读取即消费；有界等待被 effect 清理打断时，重跑仍复用同一份输入。
  const retainedPlayIntentRef = useRef<{
    key: string;
    target: NonNullable<ReturnType<typeof consumeMatchingPlayIntent>>;
  } | null>(null);
  const startStateRef = useRef<PlaybackStartState>({
    parked: false,
    pendingDuration: null,
  });
  const startGenerationRef = useRef(0);
  const cancelPlaybackStart = useCallback(() => {
    startGenerationRef.current += 1;
    clearPlaybackStartState(startStateRef.current);
  }, []);
  useEffect(() => {
    startStateRef.current.refreshPrompt?.();
  }, [detail]);

  const durationResolverRef = useRef<((duration: number) => void) | null>(null);
  const resolveStartDuration = useCallback((duration: number) => {
    if (
      !startStateRef.current.pendingDuration ||
      !(duration > 0) ||
      !Number.isFinite(duration)
    )
      return false;
    const resolve = durationResolverRef.current;
    durationResolverRef.current = null;
    resolve?.(duration);
    return true;
  }, []);

  useEffect(() => {
    searchTitleRef.current = searchTitle;
  }, [searchTitle]);

  const doSave = useCallback(
    async (immediate = false, leavingForNext = false) => {
      if (
        startStateRef.current.parked ||
        startStateRef.current.pendingDuration !== null ||
        isProgressWriteBlocked(
          historyRestoreGateRef.current,
          currentSourceRef.current,
          currentIdRef.current,
          currentEpisodeIndexRef.current,
          stableCurrentTimeRef,
        )
      ) {
        if (immediate) {
          await flushPendingPlayProgress(
            saveStateRef.current,
            lastSaveTimeRef,
            true,
          );
        }
        return;
      }
      await saveCurrentPlayProgress(
        artPlayerRef,
        currentSourceRef,
        currentIdRef,
        videoTitleRef,
        detailRef,
        currentEpisodeIndexRef,
        stableCurrentTimeRef,
        clearTargetEpisodeProgressRef,
        saveStateRef,
        lastSaveTimeRef,
        searchTitleRef.current,
        immediate,
        leavingForNext,
      );
    },
    [
      artPlayerRef,
      historyRestoreGateRef,
      clearTargetEpisodeProgressRef,
      currentEpisodeIndexRef,
      currentIdRef,
      currentSourceRef,
      detailRef,
      lastSaveTimeRef,
      saveStateRef,
      stableCurrentTimeRef,
      videoTitleRef,
    ],
  );

  const doCheckpoint = useCallback(
    (reason?: SessionLostReason) => {
      if (
        startStateRef.current.parked ||
        startStateRef.current.pendingDuration !== null ||
        isProgressWriteBlocked(
          historyRestoreGateRef.current,
          currentSourceRef.current,
          currentIdRef.current,
          currentEpisodeIndexRef.current,
          stableCurrentTimeRef,
        )
      ) {
        return;
      }
      savePlaybackCheckpoint(
        currentSourceRef,
        currentIdRef,
        currentEpisodeIndexRef,
        videoTitleRef,
        artPlayerRef,
        stableCurrentTimeRef,
        clearTargetEpisodeProgressRef,
        reason,
      );
    },
    [
      artPlayerRef,
      historyRestoreGateRef,
      clearTargetEpisodeProgressRef,
      currentEpisodeIndexRef,
      currentIdRef,
      currentSourceRef,
      stableCurrentTimeRef,
      videoTitleRef,
    ],
  );

  const persistPlaybackState = useCallback(() => {
    doCheckpoint();
    void doSave(true);
  }, [doCheckpoint, doSave]);

  const wakeLockController = useMemo(
    () => createScreenWakeLockController(wakeLockRef),
    [wakeLockRef],
  );
  const requestWakeLock = wakeLockController.request;
  const releaseWakeLock = wakeLockController.release;

  const clearSaveInterval = useCallback(() => {
    if (saveIntervalRef.current) {
      clearInterval(saveIntervalRef.current);
      saveIntervalRef.current = null;
    }
  }, [saveIntervalRef]);

  useEffect(() => {
    saveStateRef.current.lastSavedFingerprint = null;
  }, [currentSource, currentId, saveStateRef]);

  // 播放记录处理：详情就绪后优先消费显式播放意图，再检查恢复点与播放记录
  // 必须等详情到位，分组源才能按分组标签换算集索引；详情未到时换算会退化成过期绝对索引
  useEffect(() => {
    const requestedSource = currentSource;
    const requestedId = currentId;
    const requestedEpisodeIndex = currentEpisodeIndexRef.current;
    const restoreKey = getHistoryRestoreKey(currentSource, currentId);
    const historyRestoreGate = historyRestoreGateRef.current;
    let disposed = false;
    let recordsPending = false;

    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;
      if (!detailReady) return;
      if (retainedPlayIntentRef.current?.key !== restoreKey) {
        retainedPlayIntentRef.current = null;
      }
      if (restoreAppliedKeyRef.current === restoreKey) return;
      restoreAppliedKeyRef.current = restoreKey;

      const applyRestoreState = ({
        episodeIndex,
        resumeTime,
        resumeMode,
      }: {
        episodeIndex: number;
        resumeTime: number;
        resumeMode: ResumeMode;
      }) => {
        const activeEpisodeIndex = currentEpisodeIndexRef.current;
        if (episodeIndex !== activeEpisodeIndex) {
          onRestoreEpisodeChange?.();
          // 显式恢复到其它集时，同样先阻断旧播放器残留进度回写。
          clearTargetEpisodeProgressRef.current = true;
          stableCurrentTimeRef.current = 0;
          currentEpisodeIndexRef.current = episodeIndex;
          setCurrentEpisodeIndex(episodeIndex);
        }

        resumeTimeRef.current = resumeTime;
        resumeModeRef.current = resumeMode;
      };

      const applyStartPolicy = async (
        target: PlaybackStartTarget & { resumeMode: ResumeMode },
        record?: PlayRecord,
      ) => {
        const generation = startGenerationRef.current;
        const isCurrent = () =>
          !disposed &&
          generation === startGenerationRef.current &&
          requestedSource === currentSourceRef.current &&
          requestedId === currentIdRef.current &&
          !hasExplicitPlaybackSeek(stableCurrentTimeRef);
        const snapshot = detailRef.current!;
        let activeDetail = snapshot;
        let resolvedTarget = target;
        const refresh = historyRestoreGate.detailRefresh;
        const options = () => ({
          target: resolvedTarget,
          detail: activeDetail,
          autoPlayNext:
            autoPlayNextEnabledRef?.current ?? readAutoPlayNextEnabled(),
          refreshing: refresh?.key === restoreKey,
        });
        let decision = decidePlaybackStart(options());
        if (decision.kind === 'wait') {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const waiting = Promise.race([
            refresh!.promise,
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), START_DETAIL_WAIT_MS);
            }),
          ]);
          const fresh = await waiting;
          clearTimeout(timer);
          if (!isCurrent()) return;
          if (fresh) {
            activeDetail = fresh;
            resolvedTarget = {
              ...target,
              episodeIndex: remapEpisodeIndexToDetail(
                snapshot,
                fresh,
                target.episodeIndex,
              ),
            };
          }
          decision = decidePlaybackStart({
            ...options(),
            refreshing: false,
            waitExpired: !fresh,
          });
        }
        if (decision.kind === 'wait') return;
        if (
          decision.kind === 'play' &&
          decision.episodeIndex !== resolvedTarget.episodeIndex
        ) {
          const next = decision.episodeIndex;
          const nextKey = buildEpisodeProgressKeys(activeDetail)[next];
          if (!record) {
            const key = generateStorageKey(requestedSource, requestedId);
            const read = readPlayRecordsForPlayback([key]);
            // 缓存已足够决定起播时，后台核对失败仍需消费拒绝。
            if (read.cached) void read.fresh.catch(() => undefined);
            let timer: ReturnType<typeof setTimeout> | undefined;
            const waiting = read.cached
              ? Promise.resolve(read.cached)
              : Promise.race([
                  read.fresh.catch(() => null),
                  new Promise<null>((resolve) => {
                    timer = setTimeout(
                      () => resolve(null),
                      START_DETAIL_WAIT_MS,
                    );
                  }),
                ]);
            const records = await waiting;
            clearTimeout(timer);
            if (!isCurrent()) return;
            record = records?.[key];
            if (records) {
              if (!read.cached) onPlayRecordLoadedRef.current?.(key, record);
            } else {
              decision = {
                kind: 'park',
                episodeIndex: resolvedTarget.episodeIndex,
                resumeTime: resolvedTarget.resumeTime,
              };
            }
          }
          if (decision.kind === 'play') {
            const entry =
              record?.episode_progress?.find((item) => item.k === nextKey) ??
              getEpisodeEntryRef.current?.(next);
            decision = decidePlaybackStart({
              ...options(),
              refreshing: false,
              nextResumeTime: resolveEpisodeProgressResumeTime(
                entry,
                skipConfigRef?.current,
              ),
            });
          }
        }
        if (decision.kind === 'wait' || !isCurrent()) return;
        applyRestoreState({ ...decision, resumeMode: target.resumeMode });
        // applyRestoreState 的换集回调会取消旧状态，决策状态在它之后提交。
        startStateRef.current.parked = decision.kind === 'park';
        startStateRef.current.pendingDuration =
          decision.kind === 'play' && decision.needsDuration
            ? resolvedTarget
            : null;
        if (startStateRef.current.pendingDuration) {
          durationResolverRef.current = (duration) => {
            void commitStartPolicy(
              {
                ...resolvedTarget,
                episodeIndex: currentEpisodeIndexRef.current,
                recordDuration: duration,
              },
              record,
            );
          };
        }
        startStateRef.current.refreshPrompt?.();
      };

      const commitStartPolicy = (
        target: PlaybackStartTarget & { resumeMode: ResumeMode },
        record?: PlayRecord,
      ) => {
        const decision = applyStartPolicy(target, record);
        historyRestoreGate.startDecision = decision;
        return decision;
      };

      const playIntent =
        retainedPlayIntentRef.current?.key === restoreKey
          ? retainedPlayIntentRef.current.target
          : consumeMatchingPlayIntent({
              source: currentSource,
              id: currentId,
              episodeCount: detailRef.current?.episodes.length || 0,
              episodeGroups: detailRef.current?.episode_groups,
            });
      if (playIntent) {
        retainedPlayIntentRef.current = { key: restoreKey, target: playIntent };
        recordsPending = true;
        await commitStartPolicy(playIntent);
        recordsPending = false;
        if (disposed) return;
        retainedPlayIntentRef.current = null;
        settleHistoryRestore(historyRestoreGate, restoreKey);
        return;
      }

      const activeDetail = detailRef.current;
      const checkpoint = readMatchingPlaybackCheckpoint(
        currentSourceRef,
        currentIdRef,
      );

      const key = generateStorageKey(currentSource, currentId);
      let restoreEpisodeIndex = requestedEpisodeIndex;
      let initialRead: Promise<Record<string, PlayRecord>>;
      let freshRead: Promise<Record<string, PlayRecord>> | null;
      if (historyRestoreGate.playRecords) {
        initialRead = historyRestoreGate.playRecords;
        freshRead = historyRestoreGate.playRecordsFresh ?? null;
      } else {
        const read = readPlayRecordsForPlayback([key]);
        initialRead = read.cached ? Promise.resolve(read.cached) : read.fresh;
        freshRead = read.cached ? read.fresh : null;
      }

      // 读取失败不能当作没有记录，否则默认集的进度会覆盖服务器上的记录；先放行起播，保存继续阻断并重试
      let readFailureReported = false;
      const readWithRetry = async (
        firstRead: Promise<Record<string, PlayRecord>>,
      ) => {
        let request = firstRead;
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await request;
          } catch (err) {
            if (disposed) throw err;
            console.warn('读取播放记录失败，稍后重试:', err);
            // 偶发失败下次重试即恢复，连续失败才提示，每次恢复只提示一次
            if (attempt === 1 && !readFailureReported) {
              readFailureReported = true;
              reportPlaybackRecordsReadFailure(err);
            }
            settleHistoryRestore(historyRestoreGate, restoreKey);
            await new Promise((resolve) =>
              setTimeout(resolve, getPlaybackRecordsRetryDelay(attempt)),
            );
            if (disposed) throw err;
            request = readPlayRecordsForPlayback([key]).fresh;
          }
        }
      };

      const applyRecords = async (
        allRecords: Record<string, PlayRecord>,
        historyOnly: boolean,
      ) => {
        onPlayRecordLoadedRef.current?.(key, allRecords[key]);
        const record = isPlayRecordCompatibleWithDetail(
          allRecords[key],
          activeDetail,
        )
          ? allRecords[key]
          : undefined;
        const compatibleCheckpoint = isPlaybackCheckpointCompatibleWithDetail(
          checkpoint,
          activeDetail,
        )
          ? checkpoint
          : null;
        const restoreCandidate = resolvePlaybackRestoreCandidate({
          checkpoint: compatibleCheckpoint,
          record,
          episodeCount: detailRef.current?.episodes.length || 0,
          episodeGroups: detailRef.current?.episode_groups,
        });

        if (
          !restoreCandidate ||
          (historyOnly && restoreCandidate.source !== 'history')
        ) {
          return;
        }

        const targetIndex = restoreCandidate.episodeIndex;
        const targetTime = restoreCandidate.resumeTime;
        const targetMode = restoreCandidate.resumeMode;
        const targetSource = restoreCandidate.source;

        if (
          requestedSource !== currentSourceRef.current ||
          requestedId !== currentIdRef.current ||
          restoreEpisodeIndex !== currentEpisodeIndexRef.current
        ) {
          return;
        }

        const player = artPlayerRef.current;
        if (historyOnly && startStateRef.current.parked) return;
        // 记录晚于起播到达时，默认集的自然播放不代表用户选择，只有用户拖动进度才放弃恢复
        if (player && hasExplicitPlaybackSeek(stableCurrentTimeRef)) return;

        if (
          targetSource === 'history' &&
          !shouldApplyHistoryRestore({
            requestedSource,
            requestedId,
            requestedEpisodeIndex: restoreEpisodeIndex,
            activeSource: currentSourceRef.current,
            activeId: currentIdRef.current,
            activeEpisodeIndex: currentEpisodeIndexRef.current,
            allowAutoResume: allowAutoResumeRef.current || !!player,
            pendingResumeTime: resumeTimeRef.current,
            pendingResumeMode: resumeModeRef.current,
          })
        ) {
          return;
        }

        const activeEpisodeIndex = currentEpisodeIndexRef.current;
        if (player && targetTime > 0 && targetIndex === activeEpisodeIndex) {
          // 记录停在已看完的结尾，已从头起播的这集照常播放
          if (isFinishedResumeTarget(targetTime, player.duration)) return;
          try {
            if (applyResumeTime(player, targetTime)) {
              allowAutoResumeRef.current = false;
              resumeTimeRef.current = null;
              resumeModeRef.current = null;
              player.notice.show = '已回到上次看到的位置';
              return;
            }
          } catch (err) {
            console.warn('延迟恢复播放进度失败:', err);
          }
        }

        if (!player && !historyOnly) {
          await commitStartPolicy(
            {
              episodeIndex: targetIndex,
              resumeTime: targetTime,
              resumeMode: targetMode,
              recordDuration:
                targetSource === 'history' || record?.index === targetIndex + 1
                  ? record?.total_time
                  : undefined,
              knownEpisodeCount: record?.group_total ?? record?.total_episodes,
            },
            record,
          );
        } else {
          applyRestoreState({
            episodeIndex: targetIndex,
            resumeTime: targetTime,
            resumeMode: targetMode,
          });
        }
      };

      recordsPending = true;
      const pendingRestore = {
        key: restoreKey,
        episodeIndex: restoreEpisodeIndex,
      };
      historyRestoreGate.pending = pendingRestore;
      try {
        const initialRecords = await readWithRetry(initialRead);
        if (disposed) return;
        await applyRecords(initialRecords, false);

        if (freshRead) {
          // 起播先用本地缓存，网络结果比缓存新时按迟到记录再恢复一次
          settleHistoryRestore(historyRestoreGate, restoreKey);
          restoreEpisodeIndex = currentEpisodeIndexRef.current;
          pendingRestore.episodeIndex = restoreEpisodeIndex;
          const freshRecords = await readWithRetry(freshRead);
          if (disposed) return;
          if (isNewerPlayRecord(freshRecords[key], initialRecords[key])) {
            await applyRecords(freshRecords, true);
          } else {
            // 保存时间相同的缓存可能缺服务端并入的他源每集进度，进度表仍要合并网络结果
            onPlayRecordLoadedRef.current?.(key, freshRecords[key]);
          }
        }
      } catch (err) {
        if (!disposed) console.error('读取播放记录失败:', err);
      } finally {
        recordsPending = false;
        if (historyRestoreGate.pending === pendingRestore) {
          historyRestoreGate.pending = null;
        }
        // 放弃与已写好集和时间都算已决定；被打断的这轮交给重跑放行
        if (!disposed) settleHistoryRestore(historyRestoreGate, restoreKey);
      }
    };

    initFromHistory();

    return () => {
      disposed = true;
      // 读取记录期间详情刷新会重跑本 effect，不让出恢复键的话重跑直接跳过，这次恢复就静默丢了
      if (recordsPending && restoreAppliedKeyRef.current === restoreKey) {
        restoreAppliedKeyRef.current = '';
      }
    };
  }, [
    allowAutoResumeRef,
    artPlayerRef,
    clearTargetEpisodeProgressRef,
    currentEpisodeIndexRef,
    currentId,
    currentIdRef,
    currentSource,
    currentSourceRef,
    detailRef,
    historyRestoreGateRef,
    onRestoreEpisodeChange,
    resumeModeRef,
    resumeTimeRef,
    detailReady,
    autoPlayNextEnabledRef,
    skipConfigRef,
    setCurrentEpisodeIndex,
    stableCurrentTimeRef,
  ]);

  // beforeunload / visibilitychange 事件处理
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistPlaybackState();
      releaseWakeLock();
      cleanupPlayer();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistPlaybackState();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        if (artPlayerRef.current && artPlayerRef.current.playing) {
          requestWakeLock();
        }
      }
    };

    // visibilitychange 缺失时兜底持久化
    const handlePageHide = () => {
      persistPlaybackState();
      releaseWakeLock();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    artPlayerRef,
    cleanupPlayer,
    persistPlaybackState,
    releaseWakeLock,
    requestWakeLock,
  ]);

  // 卸载清理
  useEffect(() => {
    return () => {
      persistPlaybackState();
      clearSaveInterval();
      releaseWakeLock();
      cleanupPlayer();
    };
  }, [cleanupPlayer, clearSaveInterval, persistPlaybackState, releaseWakeLock]);

  return {
    startStateRef,
    resolveStartDuration,
    cancelPlaybackStart,
    saveCurrentPlayProgress: doSave,
    savePlaybackCheckpoint: doCheckpoint,
    requestWakeLock,
    releaseWakeLock,
  };
}
