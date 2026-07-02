import { Dispatch, MutableRefObject, SetStateAction, useEffect } from 'react';

import type Artplayer from 'artplayer';

import {
  generateStorageKey,
  getAllPlayRecords,
  PlayRecord,
  savePlayRecord,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

import {
  LEGACY_PLAY_CHECKPOINT_KEY,
  PLAY_CHECKPOINT_KEY,
  PlayCheckpoint,
  SessionLostReason,
  WakeLockSentinel,
} from '@/features/play/lib/playTypes';
import { consumeMatchingPlayIntent } from '@/lib/play-intent';
import {
  applyResumeTime,
  isWithinAutoResumeWindow,
} from '@/features/play/lib/resumePlayback';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';

// ---------------------------------------------------------------------------
// Checkpoint: 保存/恢复
// ---------------------------------------------------------------------------

export function savePlaybackCheckpoint(
  currentSourceRef: MutableRefObject<string>,
  currentIdRef: MutableRefObject<string>,
  currentEpisodeIndexRef: MutableRefObject<number>,
  videoTitleRef: MutableRefObject<string>,
  artPlayerRef: MutableRefObject<Artplayer | null>,
  stableCurrentTimeRef: MutableRefObject<number>,
  clearTargetEpisodeProgressRef: MutableRefObject<boolean>,
  reason?: SessionLostReason,
) {
  if (typeof window === 'undefined') return;
  if (!currentSourceRef.current || !currentIdRef.current) return;
  if (clearTargetEpisodeProgressRef.current) return;

  const currentTime = resolveProtectedPlaybackTime(
    artPlayerRef.current?.currentTime || 0,
    stableCurrentTimeRef.current,
  );
  const checkpoint: PlayCheckpoint = {
    source: currentSourceRef.current,
    id: currentIdRef.current,
    episodeIndex: Math.max(0, currentEpisodeIndexRef.current),
    currentTime: Math.max(0, Math.floor(currentTime)),
    title: videoTitleRef.current || '',
    saveTime: Date.now(),
  };

  try {
    sessionStorage.setItem(
      PLAY_CHECKPOINT_KEY,
      JSON.stringify({ ...checkpoint, reason: reason || null }),
    );
    sessionStorage.removeItem(LEGACY_PLAY_CHECKPOINT_KEY);
  } catch (error) {
    console.warn('保存播放恢复点失败:', error);
  }
}

function hasMeaningfulPlaybackTime(time: number): boolean {
  return Number.isFinite(time) && time > 1;
}

export function resolveProtectedPlaybackTime(
  playerCurrentTime: number,
  stableCurrentTime: number,
): number {
  if (hasMeaningfulPlaybackTime(playerCurrentTime)) {
    return Math.floor(playerCurrentTime);
  }

  if (hasMeaningfulPlaybackTime(stableCurrentTime)) {
    return Math.floor(stableCurrentTime);
  }

  if (Number.isFinite(playerCurrentTime) && playerCurrentTime > 0) {
    return Math.floor(playerCurrentTime);
  }

  return 0;
}

export function resolveNextStablePlaybackTime(
  nextTime: number,
  stableCurrentTime: number,
  blockProgressCarryover: boolean,
): number {
  if (blockProgressCarryover) {
    return stableCurrentTime;
  }

  if (!Number.isFinite(nextTime) || nextTime < 0) {
    return stableCurrentTime;
  }

  if (hasMeaningfulPlaybackTime(nextTime)) {
    return Math.floor(nextTime);
  }

  if (!hasMeaningfulPlaybackTime(stableCurrentTime)) {
    return Math.max(0, Math.floor(nextTime));
  }

  return stableCurrentTime;
}

function clearPlaybackCheckpointStorage() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(PLAY_CHECKPOINT_KEY);
  sessionStorage.removeItem(LEGACY_PLAY_CHECKPOINT_KEY);
}

function readPlaybackCheckpoint(): PlayCheckpoint | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw =
      sessionStorage.getItem(PLAY_CHECKPOINT_KEY) ||
      sessionStorage.getItem(LEGACY_PLAY_CHECKPOINT_KEY);
    if (!raw) return null;

    const checkpoint = JSON.parse(raw) as PlayCheckpoint;
    if (!checkpoint?.source || !checkpoint?.id) {
      clearPlaybackCheckpointStorage();
      return null;
    }

    // 仅恢复 4 小时内的检查点
    if (Date.now() - checkpoint.saveTime > 4 * 60 * 60 * 1000) {
      clearPlaybackCheckpointStorage();
      return null;
    }

    return checkpoint;
  } catch (error) {
    console.warn('读取播放恢复点失败:', error);
    clearPlaybackCheckpointStorage();
    return null;
  }
}

function readMatchingPlaybackCheckpoint(
  currentSourceRef: MutableRefObject<string>,
  currentIdRef: MutableRefObject<string>,
): PlayCheckpoint | null {
  const checkpoint = readPlaybackCheckpoint();
  if (!checkpoint) {
    return null;
  }

  if (
    checkpoint.source !== currentSourceRef.current ||
    checkpoint.id !== currentIdRef.current
  ) {
    return null;
  }

  return checkpoint;
}

function clampRestoreEpisodeIndex(
  episodeIndex: number,
  episodeCount: number,
): number {
  const safeIndex = Math.max(0, episodeIndex);
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) {
    return safeIndex;
  }

  return Math.min(safeIndex, episodeCount - 1);
}

type PlaybackRestoreSource = 'history' | 'checkpoint';

interface PlaybackRestoreCandidate {
  source: PlaybackRestoreSource;
  episodeIndex: number;
  resumeTime: number;
  resumeMode: ResumeMode;
}

interface ResolvePlaybackRestoreCandidateOptions {
  checkpoint: PlayCheckpoint | null;
  record?: PlayRecord;
  episodeCount: number;
}

function normalizeRestoreIdentityText(value?: string | null): string {
  return (value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function normalizeRestoreIdentityYear(value?: string | null): string {
  const year = (value || '').trim();
  return year && year !== 'unknown' ? year : '';
}

export function isPlayRecordCompatibleWithDetail(
  record: PlayRecord | undefined,
  detail: SearchResult | null,
): record is PlayRecord {
  if (!record) {
    return false;
  }

  if (!detail) {
    return true;
  }

  const recordTitle = normalizeRestoreIdentityText(record.title);
  const detailTitle = normalizeRestoreIdentityText(detail.title);
  if (recordTitle && detailTitle && recordTitle !== detailTitle) {
    return false;
  }

  const recordYear = normalizeRestoreIdentityYear(record.year);
  const detailYear = normalizeRestoreIdentityYear(detail.year);
  if (recordYear && detailYear && recordYear !== detailYear) {
    return false;
  }

  return true;
}

export function isPlaybackCheckpointCompatibleWithDetail(
  checkpoint: PlayCheckpoint | null,
  detail: SearchResult | null,
): checkpoint is PlayCheckpoint {
  if (!checkpoint) {
    return false;
  }

  if (!detail) {
    return true;
  }

  const checkpointTitle = normalizeRestoreIdentityText(checkpoint.title);
  const detailTitle = normalizeRestoreIdentityText(detail.title);
  return !checkpointTitle || !detailTitle || checkpointTitle === detailTitle;
}

/**
 * 同一条播放链路里，继续观看记录与检查点同时存在时，优先采用更新时间更晚的那一份。
 * 这样首页看到的最新进度不会再被旧 checkpoint 反向覆盖。
 */
export function resolvePlaybackRestoreCandidate({
  checkpoint,
  record,
  episodeCount,
}: ResolvePlaybackRestoreCandidateOptions): PlaybackRestoreCandidate | null {
  const historyCandidate = record
    ? {
        source: 'history' as const,
        episodeIndex: clampRestoreEpisodeIndex(record.index - 1, episodeCount),
        resumeTime: Math.max(0, Math.floor(record.play_time || 0)),
        resumeMode: (record.play_time > 0 ? 'history' : null) as ResumeMode,
        updatedAt: record.save_time || 0,
      }
    : null;

  const checkpointCandidate = checkpoint
    ? {
        source: 'checkpoint' as const,
        episodeIndex: clampRestoreEpisodeIndex(
          checkpoint.episodeIndex,
          episodeCount,
        ),
        resumeTime: Math.max(0, Math.floor(checkpoint.currentTime || 0)),
        resumeMode: (checkpoint.currentTime > 0
          ? 'forced'
          : null) as ResumeMode,
        updatedAt: checkpoint.saveTime || 0,
      }
    : null;

  const selectedCandidate =
    historyCandidate && checkpointCandidate
      ? hasMeaningfulPlaybackTime(historyCandidate.resumeTime) !==
        hasMeaningfulPlaybackTime(checkpointCandidate.resumeTime)
        ? hasMeaningfulPlaybackTime(checkpointCandidate.resumeTime)
          ? checkpointCandidate
          : historyCandidate
        : checkpointCandidate.updatedAt > historyCandidate.updatedAt
          ? checkpointCandidate
          : historyCandidate
      : historyCandidate || checkpointCandidate;

  if (!selectedCandidate) {
    return null;
  }

  return {
    source: selectedCandidate.source,
    episodeIndex: selectedCandidate.episodeIndex,
    resumeTime: selectedCandidate.resumeTime,
    resumeMode: selectedCandidate.resumeMode,
  };
}

// ---------------------------------------------------------------------------
// 保存播放进度到 IndexedDB
// ---------------------------------------------------------------------------

type PendingPlayProgressSave = {
  source: string;
  id: string;
  record: PlayRecord;
  fingerprint: string;
};

interface HistoryRestoreGuardOptions {
  requestedSource: string;
  requestedId: string;
  requestedEpisodeIndex: number;
  activeSource: string;
  activeId: string;
  activeEpisodeIndex: number;
  allowAutoResume: boolean;
  pendingResumeTime: number | null;
  pendingResumeMode: ResumeMode;
}

/**
 * 历史记录是异步读取的，应用前必须再次确认当前仍是同一条播放链路，
 * 并且不能覆盖换源、手动切集或检查点已经写入的显式恢复意图。
 */
export function shouldApplyHistoryRestore({
  requestedSource,
  requestedId,
  requestedEpisodeIndex,
  activeSource,
  activeId,
  activeEpisodeIndex,
  allowAutoResume,
  pendingResumeTime,
  pendingResumeMode,
}: HistoryRestoreGuardOptions): boolean {
  if (!allowAutoResume) {
    return false;
  }

  if (!requestedSource || !requestedId) {
    return false;
  }

  if (requestedSource !== activeSource || requestedId !== activeId) {
    return false;
  }

  if (requestedEpisodeIndex !== activeEpisodeIndex) {
    return false;
  }

  if (pendingResumeMode === 'forced') {
    return false;
  }

  return true;
}

export interface PlayProgressSaveState {
  inFlight: boolean;
  pending: PendingPlayProgressSave | null;
  lastSavedFingerprint: string | null;
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

async function flushPlayProgressSave(
  saveStateRef: MutableRefObject<PlayProgressSaveState>,
  lastSaveTimeRef: MutableRefObject<number>,
  payload: PendingPlayProgressSave,
): Promise<void> {
  saveStateRef.current.inFlight = true;
  lastSaveTimeRef.current = Date.now();

  try {
    await savePlayRecord(payload.source, payload.id, payload.record);
    saveStateRef.current.lastSavedFingerprint = payload.fingerprint;
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
  const currentTime = resolveProtectedPlaybackTime(
    player.currentTime || 0,
    stableCurrentTimeRef.current,
  );
  const duration = player.duration || 0;

  // 播放时间太短或视频时长无效，不保存
  if (!hasMeaningfulPlaybackTime(currentTime) || !duration) {
    return;
  }

  const record: PlayRecord = {
    title: videoTitleRef.current,
    source_name: detailRef.current?.source_name || '',
    year: detailRef.current?.year,
    cover: detailRef.current?.poster || '',
    index: currentEpisodeIndexRef.current + 1,
    total_episodes: detailRef.current?.episodes.length || 1,
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

  try {
    if (saveStateRef.current.inFlight) {
      saveStateRef.current.pending = {
        source: currentSourceRef.current,
        id: currentIdRef.current,
        record,
        fingerprint,
      };
      return;
    }

    await flushPlayProgressSave(saveStateRef, lastSaveTimeRef, {
      source: currentSourceRef.current,
      id: currentIdRef.current,
      record,
      fingerprint,
    });
  } catch (err) {
    console.error('保存播放进度失败:', err);
  }
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
  searchTitle: string;
  currentSource: string;
  currentId: string;
  currentEpisodeIndex: number;
  detail: SearchResult | null;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
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
  searchTitle,
  currentSource,
  currentId,
  currentEpisodeIndex,
  detail,
  setCurrentEpisodeIndex,
  cleanupPlayer,
}: UsePlayProgressParams) {
  const doSave = () =>
    saveCurrentPlayProgress(
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
      searchTitle,
    );

  const doCheckpoint = (reason?: SessionLostReason) =>
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

  const persistPlaybackState = () => {
    doCheckpoint();
    void doSave();
  };

  const requestWakeLock = async () => {
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
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  useEffect(() => {
    // 切换到新视频时丢弃旧请求的排队状态，避免旧进度回写到新条目。
    saveStateRef.current.pending = null;
    saveStateRef.current.lastSavedFingerprint = null;
  }, [currentSource, currentId]);

  // 播放记录处理：source/id 就绪后优先消费显式播放意图，再检查恢复点与播放记录
  useEffect(() => {
    const requestedSource = currentSource;
    const requestedId = currentId;
    const requestedEpisodeIndex = currentEpisodeIndexRef.current;
    let disposed = false;

    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

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
      });
      if (playIntent) {
        applyRestoreState(playIntent);
        return;
      }

      const activeDetail = detailRef.current;
      const checkpoint = readMatchingPlaybackCheckpoint(
        currentSourceRef,
        currentIdRef,
      );

      try {
        const allRecords = await getAllPlayRecords();
        if (disposed) {
          return;
        }

        const key = generateStorageKey(currentSource, currentId);
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
        });

        if (checkpoint) {
          clearPlaybackCheckpointStorage();
        }

        if (!restoreCandidate) {
          return;
        }

        const targetIndex = restoreCandidate.episodeIndex;
        const targetTime = restoreCandidate.resumeTime;
        const targetMode = restoreCandidate.resumeMode;
        const targetSource = restoreCandidate.source;

        if (
          requestedSource !== currentSourceRef.current ||
          requestedId !== currentIdRef.current ||
          requestedEpisodeIndex !== currentEpisodeIndexRef.current
        ) {
          return;
        }

        if (
          targetSource === 'history' &&
          !shouldApplyHistoryRestore({
            requestedSource,
            requestedId,
            requestedEpisodeIndex,
            activeSource: currentSourceRef.current,
            activeId: currentIdRef.current,
            activeEpisodeIndex: currentEpisodeIndexRef.current,
            allowAutoResume: allowAutoResumeRef.current,
            pendingResumeTime: resumeTimeRef.current,
            pendingResumeMode: resumeModeRef.current,
          })
        ) {
          return;
        }

        const activeEpisodeIndex = currentEpisodeIndexRef.current;
        const player = artPlayerRef.current;
        const canApplyImmediately =
          targetTime > 0 &&
          targetIndex === activeEpisodeIndex &&
          player &&
          (targetSource === 'checkpoint' ||
            isWithinAutoResumeWindow(player.currentTime || 0));

        if (canApplyImmediately) {
          try {
            if (applyResumeTime(player, targetTime)) {
              allowAutoResumeRef.current = false;
              resumeTimeRef.current = null;
              resumeModeRef.current = null;
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
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();

    return () => {
      disposed = true;
    };
  }, [currentSource, currentId]);

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

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // 组件卸载时清理定时器、Wake Lock 和播放器资源
  useEffect(() => {
    return () => {
      persistPlaybackState();
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
      releaseWakeLock();
      cleanupPlayer();
    };
  }, []);

  return {
    saveCurrentPlayProgress: doSave,
    savePlaybackCheckpoint: doCheckpoint,
    requestWakeLock,
    releaseWakeLock,
  };
}
