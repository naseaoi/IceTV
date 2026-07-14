'use client';

import type Artplayer from 'artplayer';
import { MutableRefObject, useCallback, useEffect, useRef } from 'react';

import type { PlaybackSession, SearchResult } from '@/lib/types';

type PlaybackStatsSessionState = {
  id: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  startedAt: number;
  createdAt: number;
  lastReportedAt: number;
  lastPosition: number;
  watchSeconds: number;
};

type UsePlaybackStatsReporterParams = {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  videoTitleRef: MutableRefObject<string>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  stableCurrentTimeRef: MutableRefObject<number>;
};

const REPORT_INTERVAL_MS = 30_000;
const MAX_DELTA_SECONDS = 10 * 60;

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );
}

function getCurrentPosition(
  artPlayerRef: MutableRefObject<Artplayer | null>,
  stableCurrentTimeRef: MutableRefObject<number>,
): number {
  const current = artPlayerRef.current?.currentTime || 0;
  const stable = stableCurrentTimeRef.current || 0;
  return Math.max(0, Math.floor(Math.max(current, stable)));
}

function getDuration(artPlayerRef: MutableRefObject<Artplayer | null>): number {
  const duration = artPlayerRef.current?.duration || 0;
  return Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0;
}

async function sendPlaybackSession(session: PlaybackSession): Promise<void> {
  const response = await fetch('/api/playback-stats/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
    keepalive: true,
  });

  if (!response.ok) {
    throw new Error(`Playback stats request failed: ${response.status}`);
  }
}

export function usePlaybackStatsReporter({
  artPlayerRef,
  currentSourceRef,
  currentIdRef,
  videoTitleRef,
  detailRef,
  currentEpisodeIndexRef,
  stableCurrentTimeRef,
}: UsePlaybackStatsReporterParams) {
  const sessionRef = useRef<PlaybackStatsSessionState | null>(null);
  const inFlightRef = useRef(false);
  const pendingSessionRef = useRef<PlaybackSession | null>(null);

  const getActiveSession = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return null;

    const source = currentSourceRef.current;
    const videoId = currentIdRef.current;
    const episodeIndex = currentEpisodeIndexRef.current + 1;

    if (
      current.source !== source ||
      current.videoId !== videoId ||
      current.episodeIndex !== episodeIndex
    ) {
      return null;
    }

    return current;
  }, [currentSourceRef, currentIdRef, currentEpisodeIndexRef]);

  const ensureSession = useCallback(() => {
    const source = currentSourceRef.current;
    const videoId = currentIdRef.current;
    const episodeIndex = currentEpisodeIndexRef.current + 1;
    const title = videoTitleRef.current;

    if (!source || !videoId || !title) return null;

    const current = sessionRef.current;
    if (
      current &&
      current.source === source &&
      current.videoId === videoId &&
      current.episodeIndex === episodeIndex
    ) {
      return current;
    }

    const now = Date.now();
    const position = getCurrentPosition(artPlayerRef, stableCurrentTimeRef);
    const next: PlaybackStatsSessionState = {
      id: createSessionId(),
      source,
      videoId,
      episodeIndex,
      startedAt: now,
      createdAt: now,
      lastReportedAt: now,
      lastPosition: position,
      watchSeconds: 0,
    };
    sessionRef.current = next;
    return next;
  }, [
    artPlayerRef,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    currentEpisodeIndexRef,
    stableCurrentTimeRef,
  ]);

  const flushNetworkQueue = useCallback(async (session: PlaybackSession) => {
    if (inFlightRef.current) {
      pendingSessionRef.current = session;
      return;
    }

    pendingSessionRef.current = session;
    inFlightRef.current = true;
    try {
      while (pendingSessionRef.current) {
        const nextSession = pendingSessionRef.current;
        pendingSessionRef.current = null;
        try {
          await sendPlaybackSession(nextSession);
        } catch (error) {
          console.warn('播放统计上报失败:', error);
        }
      }
    } catch (error) {
      console.warn('播放统计上报失败:', error);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const reportPlaybackStats = useCallback(
    (force = false) => {
      const state = getActiveSession();
      if (!state) return;

      const now = Date.now();
      const currentPosition = getCurrentPosition(
        artPlayerRef,
        stableCurrentTimeRef,
      );
      const elapsedSeconds = Math.max(
        0,
        Math.floor((now - state.lastReportedAt) / 1000),
      );
      const positionDelta = Math.max(0, currentPosition - state.lastPosition);
      const delta = Math.min(positionDelta, elapsedSeconds, MAX_DELTA_SECONDS);

      if (!force && now - state.lastReportedAt < REPORT_INTERVAL_MS) {
        return;
      }

      state.watchSeconds += delta;
      state.lastReportedAt = now;
      state.lastPosition = currentPosition;

      if (state.watchSeconds <= 0 && !force) {
        return;
      }

      const detail = detailRef.current;
      const payload: PlaybackSession = {
        id: state.id,
        source: state.source,
        video_id: state.videoId,
        episode_index: state.episodeIndex,
        title: videoTitleRef.current,
        source_name: detail?.source_name || '',
        cover: detail?.poster || '',
        year: detail?.year || '',
        started_at: state.startedAt,
        ended_at: now,
        watch_seconds: state.watchSeconds,
        last_position: currentPosition,
        total_time: getDuration(artPlayerRef),
        created_at: state.createdAt,
        updated_at: now,
      };

      void flushNetworkQueue(payload);
    },
    [
      getActiveSession,
      artPlayerRef,
      stableCurrentTimeRef,
      detailRef,
      videoTitleRef,
      flushNetworkQueue,
    ],
  );

  useEffect(() => {
    const handleBeforeUnload = () => {
      reportPlaybackStats(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        reportPlaybackStats(true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reportPlaybackStats(true);
    };
  }, [reportPlaybackStats]);

  return {
    startPlaybackStatsSession: ensureSession,
    reportPlaybackStats,
  };
}
