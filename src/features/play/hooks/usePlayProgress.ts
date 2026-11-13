import type Artplayer from 'artplayer';
import { Dispatch, MutableRefObject, SetStateAction, useEffect } from 'react';
import { useCallback, useRef } from 'react';

import { resolveEpisodeGroupPosition } from '@/features/play/lib/episodeGroups';
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
import { applyResumeTime } from '@/features/play/lib/resumePlayback';
import {
  generateStorageKey,
  PlayRecord,
  readPlayRecordsForPlayback,
  reportPlaybackRecordsReadFailure,
  savePlayRecord,
} from '@/lib/db.client';
import { consumeMatchingPlayIntent } from '@/lib/play-intent';
import { SearchResult } from '@/lib/types';

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
// 保存播放进度到 IndexedDB
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
  inFlight: boolean;
  pending: PendingPlayProgressSave | null;
  lastSavedFingerprint: string | null;
  activeFingerprints?: Set<string>;
  latestSaveToken?: object;
  onSaved?: (source: string, id: string) => void | Promise<void>;
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
  payload: PendingPlayProgressSave,
): Promise<void> {
  const active = (state.activeFingerprints ??= new Set());
  active.add(payload.fingerprint);
  const token = {};
  state.latestSaveToken = token;
  try {
    await savePlayRecord(payload.source, payload.id, payload.record);
    if (state.latestSaveToken === token) {
      state.lastSavedFingerprint = payload.fingerprint;
    }
    await state.onSaved?.(payload.source, payload.id);
  } finally {
    active.delete(payload.fingerprint);
  }
}

async function flushPlayProgressSave(
  saveStateRef: MutableRefObject<PlayProgressSaveState>,
  lastSaveTimeRef: MutableRefObject<number>,
  payload: PendingPlayProgressSave,
): Promise<void> {
  saveStateRef.current.inFlight = true;
  lastSaveTimeRef.current = Date.now();

  try {
    await persistPlayProgressSave(saveStateRef.current, payload);
  } finally {
    saveStateRef.current.inFlight = false;

    const pending = saveStateRef.current.pending;
    saveStateRef.current.pending = null;

    if (
      pending &&
      pending.fingerprint !== saveStateRef.current.lastSavedFingerprint
    ) {
      await flushPlayProgressSave(saveStateRef, lastSaveTimeRef, pending);
    }
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
) {
  if (
    !artPlayerRef.current ||
    !currentSourceRef.current ||
    !currentIdRef.current ||
    !videoTitleRef.current ||
    !detailRef.current?.source_name
  ) {
    return;
  }

  // 目标集尚未真正起播前，禁止把上一集的时间写进当前集记录。
  if (clearTargetEpisodeProgressRef.current) {
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
    play_time: Math.floor(currentTime),
    total_time: Math.floor(duration),
    save_time: Date.now(),
    search_title: searchTitle,
  };

  const fingerprint = buildPlayProgressFingerprint(
    currentSourceRef.current,
    currentIdRef.current,
    record,
  );

  if (fingerprint === saveStateRef.current.lastSavedFingerprint) {
    return;
  }

  const state = saveStateRef.current;
  state.sessionId ??=
    typeof globalThis.crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  record.progress_session_id = state.sessionId;
  record.progress_sequence = state.sequence = (state.sequence ?? 0) + 1;

  const payload = {
    source: currentSourceRef.current,
    id: currentIdRef.current,
    record,
    fingerprint,
  };
  try {
    if (immediate) {
      // savePlayRecord 使用 keepalive；退出时直接发出，不等待普通保存队列。
      saveStateRef.current.pending = null;
      if (saveStateRef.current.activeFingerprints?.has(fingerprint)) return;
      lastSaveTimeRef.current = Date.now();
      await persistPlayProgressSave(saveStateRef.current, payload);
      return;
    }
    if (saveStateRef.current.inFlight) {
      saveStateRef.current.pending = payload;
      return;
    }

    await flushPlayProgressSave(saveStateRef, lastSaveTimeRef, payload);
  } catch (err) {
    console.error('保存播放进度失败:', err);
  }
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
  playRecords: Promise<Record<string, PlayRecord>> | null;
  // playRecords 来自本地缓存时的网络核对结果；缓存可能落后于其他设备
  playRecordsFresh?: Promise<Record<string, PlayRecord>> | null;
  settledKey: string;
  listeners: Set<(key: string) => void>;
  // 正在等权威播放记录的作品与集；起播等待超时后按默认集播放，这段进度不能覆盖还没读到的记录
  pending?: { key: string; episodeIndex: number } | null;
}

const HISTORY_READ_RETRY_MAX_DELAY_MS = 30_000;

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
    const timer = setTimeout(finish, timeoutMs);
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
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  onRestoreEpisodeChange?: () => void;
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
  setCurrentEpisodeIndex,
  onRestoreEpisodeChange,
  cleanupPlayer,
}: UsePlayProgressParams) {
  const searchTitleRef = useRef(searchTitle);
  const restoreAppliedKeyRef = useRef('');

  useEffect(() => {
    searchTitleRef.current = searchTitle;
  }, [searchTitle]);

  const doSave = useCallback(
    async (immediate = false) => {
      if (
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

  const requestWakeLock = useCallback(async () => {
    try {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        console.debug('Wake Lock 页面不可见，跳过请求');
        return;
      }
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (
          navigator as unknown as {
            wakeLock: { request: (type: string) => Promise<WakeLockSentinel> };
          }
        ).wakeLock.request('screen');
      }
    } catch (err) {
      const wakeLockMessage =
        err instanceof Error ? err.message.toLowerCase() : '';
      if (
        err instanceof DOMException &&
        err.name === 'NotAllowedError' &&
        (wakeLockMessage.includes('not visible') ||
          (typeof document !== 'undefined' &&
            document.visibilityState !== 'visible'))
      ) {
        console.debug('Wake Lock 页面不可见，浏览器拒绝请求:', err);
        return;
      }
      console.warn('Wake Lock 请求失败:', err);
    }
  }, [wakeLockRef]);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  }, [wakeLockRef]);

  const clearSaveInterval = useCallback(() => {
    if (saveIntervalRef.current) {
      clearInterval(saveIntervalRef.current);
      saveIntervalRef.current = null;
    }
  }, [saveIntervalRef]);

  useEffect(() => {
    // 切换到新视频时丢弃旧请求的排队状态，避免旧进度回写到新条目。
    saveStateRef.current.pending = null;
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
      if (!detail?.episodes?.length) return;
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

      const playIntent = consumeMatchingPlayIntent({
        source: currentSource,
        id: currentId,
        episodeCount: detailRef.current?.episodes.length || 0,
        episodeGroups: detailRef.current?.episode_groups,
      });
      if (playIntent) {
        applyRestoreState(playIntent);
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
              setTimeout(
                resolve,
                Math.min(1000 * 2 ** attempt, HISTORY_READ_RETRY_MAX_DELAY_MS),
              ),
            );
            if (disposed) throw err;
            request = readPlayRecordsForPlayback([key]).fresh;
          }
        }
      };

      const applyRecords = (
        allRecords: Record<string, PlayRecord>,
        historyOnly: boolean,
      ) => {
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

        applyRestoreState({
          episodeIndex: targetIndex,
          resumeTime: targetTime,
          resumeMode: targetMode,
        });
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
        applyRecords(initialRecords, false);

        if (freshRead) {
          // 起播先用本地缓存，网络结果比缓存新时按迟到记录再恢复一次
          settleHistoryRestore(historyRestoreGate, restoreKey);
          restoreEpisodeIndex = currentEpisodeIndexRef.current;
          pendingRestore.episodeIndex = restoreEpisodeIndex;
          const freshRecords = await readWithRetry(freshRead);
          if (disposed) return;
          if (isNewerPlayRecord(freshRecords[key], initialRecords[key])) {
            applyRecords(freshRecords, true);
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
    detail,
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
    saveCurrentPlayProgress: doSave,
    savePlaybackCheckpoint: doCheckpoint,
    requestWakeLock,
    releaseWakeLock,
  };
}
