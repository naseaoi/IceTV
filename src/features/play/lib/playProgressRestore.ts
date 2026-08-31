import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import {
  type PlayCheckpoint,
  type SessionLostReason,
  LEGACY_PLAY_CHECKPOINT_KEY,
  PLAY_CHECKPOINT_KEY,
} from '@/features/play/lib/playTypes';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import type { PlayRecord } from '@/lib/db.client';
import {
  clampEpisodeIndex,
  resolvePlayRecordEpisode,
} from '@/lib/episode-groups';
import type { EpisodeGroup, SearchResult } from '@/lib/types';

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

  // 起播前的 0 进度不是有效恢复点：写进去只会用一个从未出现过的位置
  // 覆盖掉真实进度，并让集索引停留在挂载时的默认值。
  if (!hasMeaningfulPlaybackTime(currentTime)) {
    return;
  }

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

export function hasMeaningfulPlaybackTime(time: number): boolean {
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

export function clearPlaybackCheckpointStorage() {
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

export function readMatchingPlaybackCheckpoint(
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
  return clampEpisodeIndex(episodeIndex, episodeCount);
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
  episodeGroups?: EpisodeGroup[];
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

export function resolvePlaybackRestoreCandidate({
  checkpoint,
  record,
  episodeCount,
  episodeGroups,
}: ResolvePlaybackRestoreCandidateOptions): PlaybackRestoreCandidate | null {
  const historyCandidate = record
    ? {
        source: 'history' as const,
        episodeIndex: resolvePlayRecordEpisode(
          record,
          episodeGroups,
          episodeCount,
        ).episodeIndex,
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

export function shouldApplyHistoryRestore({
  requestedSource,
  requestedId,
  requestedEpisodeIndex,
  activeSource,
  activeId,
  activeEpisodeIndex,
  allowAutoResume,
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
